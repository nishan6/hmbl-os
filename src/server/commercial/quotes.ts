import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { allocateNumber } from "@/server/numbering/service";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput, parseNestedInput } from "@/lib/parse";
import { MILLI, priceLine, quoteTotals, validateLine, type LineInput } from "@/lib/pricing";
import { commercialSettingsFor } from "./settings";
import { createQuoteInput, draftInput, type CreateQuoteInput, type DraftInput } from "./schemas";

/*
 * Quotes belong to the legal entity that would contract the work and are
 * checked against it; one outside the actor's entities is reported as not
 * found. Prices are always recalculated here from the lines: the editor's
 * live totals are a preview and are never trusted.
 */

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

/**
 * Cost, margin, markup and internal notes are internal. People who build
 * quotes see them; people who can only view quotes need view_sensitive.
 */
export function canSeeCosts(actor: Actor, legalEntityId: string) {
  const scope = { legalEntityId };
  return can(actor, "commercial.edit", scope) || can(actor, "commercial.view_sensitive", scope);
}

/** Today's date in a time zone, as midnight UTC (how @db.Date values are read). */
export function localToday(timeZone: string, now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${day}T00:00:00Z`);
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

type ScheduleItem = { label: string; percentBps: number; trigger: string; days: number };

async function paymentSnapshot(
  tx: Prisma.TransactionClient | typeof db,
  where: Prisma.PaymentTermWhereInput,
) {
  const term = await tx.paymentTerm.findFirst({
    where: { status: "ACTIVE", ...where },
    include: { instalments: { orderBy: { position: "asc" } } },
  });
  if (!term) return null;
  const schedule: ScheduleItem[] = term.instalments.map((i) => ({
    label: i.label,
    percentBps: i.percentBps,
    trigger: i.trigger,
    days: i.days,
  }));
  return { paymentTermId: term.id, paymentTermName: term.name, paymentSchedule: schedule };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const quoteInclude = {
  legalEntity: {
    select: {
      id: true,
      code: true,
      legalName: true,
      baseCurrency: true,
      countryCode: true,
      timezone: true,
    },
  },
  client: { select: { id: true, name: true } },
  opportunity: { select: { id: true, title: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.QuoteInclude;

export type QuoteListOptions = {
  legalEntityId?: string | null;
  clientId?: string;
  opportunityId?: string;
  search?: string;
};

export async function listQuotes(actor: Actor, options: QuoteListOptions = {}) {
  authorize(actor, "commercial.view");
  const search = options.search?.trim();
  const quotes = await db.quote.findMany({
    where: {
      ...entityFilter(actor, "commercial.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.opportunityId ? { opportunityId: options.opportunityId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: "insensitive" as const } },
              { title: { contains: search, mode: "insensitive" as const } },
              { client: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: {
      ...quoteInclude,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, status: true, currency: true, totalMinor: true, validUntil: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return quotes.map(({ versions, ...quote }) => ({ ...quote, latest: versions[0]! }));
}

/** A quote with every version's summary and one version in full (the latest by default). */
export async function getQuote(actor: Actor, id: string, options: { version?: number } = {}) {
  const quote = await db.quote.findUnique({
    where: { id },
    include: {
      ...quoteInclude,
      createdBy: { select: { id: true, name: true } },
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          status: true,
          currency: true,
          totalMinor: true,
          createdAt: true,
        },
      },
    },
  });
  if (!quote) throw new NotFoundError();
  try {
    authorize(actor, "commercial.view", { legalEntityId: quote.legalEntityId });
  } catch {
    throw new NotFoundError();
  }
  const number = options.version ?? quote.currentVersion;
  const version = await db.quoteVersion.findUnique({
    where: { quoteId_version: { quoteId: id, version: number } },
    include: {
      contact: { select: { id: true, name: true, email: true } },
      lines: { orderBy: { position: "asc" } },
    },
  });
  if (!version) throw new NotFoundError();
  const showCosts = canSeeCosts(actor, quote.legalEntityId);
  return {
    ...quote,
    showCosts,
    version: showCosts ? version : hideCosts(version),
    isLatest: number === quote.currentVersion,
  };
}

function hideCosts<
  V extends { internalNotes: string | null; costMinor: bigint; marginBps: number | null },
  L extends {
    unitCostMinor: bigint;
    costMinor: bigint;
    markupBps: number | null;
    marginBps: number | null;
  },
>(version: V & { lines: L[] }) {
  return {
    ...version,
    internalNotes: null,
    costMinor: 0n,
    marginBps: null,
    lines: version.lines.map((l) => ({
      ...l,
      unitCostMinor: 0n,
      costMinor: 0n,
      markupBps: null,
      marginBps: null,
    })),
  };
}

/** Choices for the quote editor: contacts at the client, tax rates, units and payment terms. */
export async function getDraftOptions(actor: Actor, quoteId: string) {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: { legalEntity: { select: { countryCode: true } } },
  });
  if (!quote) throw new NotFoundError();
  authorize(actor, "commercial.edit", { legalEntityId: quote.legalEntityId });
  const [contacts, taxRates, units, paymentTerms] = await Promise.all([
    db.contact.findMany({
      where: { clientId: quote.clientId, status: "ACTIVE" },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    db.taxRate.findMany({
      where: { countryCode: quote.legalEntity.countryCode, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { rateBps: "desc" }],
      select: { id: true, code: true, name: true, rateBps: true },
    }),
    db.unit.findMany({
      where: { status: "ACTIVE" },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.paymentTerm.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);
  return { contacts, taxRates, units, paymentTerms };
}

// ─── Creating ────────────────────────────────────────────────────────────────

/**
 * Starts a quote with version 1 in draft. Currency, dates and venue come from
 * the opportunity when there is one; tax and payment terms from the defaults.
 */
export async function createQuote(actor: Actor, raw: CreateQuoteInput) {
  const input = parseInput(createQuoteInput, raw);
  authorize(actor, "commercial.create", { legalEntityId: input.legalEntityId });
  const [entity, client, opportunity] = await Promise.all([
    db.legalEntity.findUnique({ where: { id: input.legalEntityId } }),
    db.client.findUnique({
      where: { id: input.clientId },
      include: { contacts: { where: { status: "ACTIVE", isPrimary: true } } },
    }),
    input.opportunityId ? db.opportunity.findUnique({ where: { id: input.opportunityId } }) : null,
  ]);
  if (!entity || entity.status !== "ACTIVE") throw invalid("legalEntityId", "Unknown legal entity");
  if (!client || client.status !== "ACTIVE") throw invalid("clientId", "Unknown client");
  if (input.opportunityId) {
    if (
      !opportunity ||
      opportunity.clientId !== client.id ||
      opportunity.legalEntityId !== entity.id
    ) {
      throw invalid("opportunityId", "Choose an opportunity for this client and entity");
    }
    if (opportunity.closedAt) throw invalid("opportunityId", "This opportunity is closed");
  }
  let contactId = input.contactId ?? opportunity?.contactId ?? client.contacts[0]?.id ?? null;
  if (input.contactId) {
    const contact = await db.contact.findUnique({ where: { id: input.contactId } });
    if (!contact || contact.clientId !== client.id || contact.status !== "ACTIVE") {
      throw invalid("contactId", "Choose a contact at this client");
    }
    contactId = contact.id;
  }
  const currency = opportunity?.currency ?? client.currency;
  const [tax, settings] = await Promise.all([
    db.taxRate.findFirst({
      where: { countryCode: entity.countryCode, isDefault: true, status: "ACTIVE" },
    }),
    commercialSettingsFor(db, entity.id),
  ]);

  return db.$transaction(async (tx) => {
    const { number } = await allocateNumber(tx, {
      documentType: "quotation",
      legalEntityId: entity.id,
    });
    const quote = await tx.quote.create({
      data: {
        legalEntityId: entity.id,
        number,
        clientId: client.id,
        opportunityId: opportunity?.id ?? null,
        title: input.title,
        ownerId: opportunity?.ownerId ?? actor.id,
        createdById: actor.id,
      },
    });
    const version = await tx.quoteVersion.create({
      data: {
        quoteId: quote.id,
        version: 1,
        contactId,
        currency,
        validUntil: addDays(localToday(entity.timezone), settings.quoteValidityDays),
        ...((await paymentSnapshot(tx, { isDefault: true })) ?? {}),
        taxRateId: tax?.id ?? null,
        taxRateBps: tax?.rateBps ?? 0,
        eventStartDate: opportunity?.eventStartDate ?? null,
        eventEndDate: opportunity?.eventEndDate ?? null,
        venue: opportunity?.venue ?? null,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "quote.created",
      targetType: "quote",
      targetId: quote.id,
      legalEntityId: entity.id,
      changes: diffChanges(null, { ...quote, currency: version.currency }, [
        "number",
        "clientId",
        "opportunityId",
        "title",
        "currency",
      ]),
    });
    return quote;
  });
}

// ─── Editing a draft ─────────────────────────────────────────────────────────

const VERSION_FIELDS = [
  "contactId",
  "currency",
  "fxRateToBase",
  "fxNote",
  "validUntil",
  "paymentTermId",
  "taxRateId",
  "taxRateBps",
  "contingencyBps",
  "poRequired",
  "eventStartDate",
  "eventEndDate",
  "venue",
  "scope",
  "deliverables",
  "exclusions",
  "terms",
  "internalNotes",
  "subtotalMinor",
  "discountMinor",
  "contingencyMinor",
  "taxMinor",
  "totalMinor",
  "costMinor",
  "marginBps",
] as const;

const LINE_FIELD = {
  quantityMilli: "quantity",
  daysMilli: "days",
  unitCostMinor: "unitCost",
  unitPriceMinor: "unitPrice",
  markupBps: "markup",
  marginBps: "margin",
  discountBps: "discount",
  taxRateBps: "taxRateId",
  method: "method",
} as const satisfies Record<keyof LineInput, string>;

const milliToDecimal = (milli: bigint) =>
  new Prisma.Decimal(`${milli / MILLI}.${(milli % MILLI).toString().padStart(3, "0")}`);

/** Thousandths from a stored Decimal(12,3). */
export const decimalToMilli = (value: Prisma.Decimal | string | number) =>
  BigInt(new Prisma.Decimal(value).mul(1000).toFixed(0));

/**
 * Saves the whole draft: details and every line. Lines are priced here, the
 * totals stored, and the save audited with what changed. Only the latest
 * version, while it is a draft, can be saved.
 */
export async function saveDraft(actor: Actor, quoteId: string, raw: DraftInput) {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: { legalEntity: true },
  });
  if (!quote) throw new NotFoundError();
  try {
    authorize(actor, "commercial.view", { legalEntityId: quote.legalEntityId });
  } catch {
    throw new NotFoundError();
  }
  authorize(actor, "commercial.edit", { legalEntityId: quote.legalEntityId });
  const input = parseNestedInput(draftInput, raw);
  const entity = quote.legalEntity;

  if (input.currency === entity.baseCurrency) input.fxRateToBase = null;

  const [contact, taxRates, units] = await Promise.all([
    input.contactId ? db.contact.findUnique({ where: { id: input.contactId } }) : null,
    db.taxRate.findMany({ where: { countryCode: entity.countryCode, status: "ACTIVE" } }),
    db.unit.findMany({ where: { status: "ACTIVE" } }),
  ]);
  if (
    input.contactId &&
    (!contact || contact.clientId !== quote.clientId || contact.status !== "ACTIVE")
  ) {
    throw invalid("contactId", "Choose a contact at this client");
  }
  const taxById = new Map(taxRates.map((t) => [t.id, t]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const headerTax = input.taxRateId ? taxById.get(input.taxRateId) : undefined;
  if (input.taxRateId && !headerTax) throw invalid("taxRateId", "Choose an active tax rate");

  const errors: Record<string, string[]> = {};
  const priced = input.lines.map((line, i) => {
    const tax = line.taxRateId ? taxById.get(line.taxRateId) : headerTax;
    if (line.taxRateId && !tax) errors[`lines.${i}.taxRateId`] = ["Choose an active tax rate"];
    const unit = line.unitId ? unitById.get(line.unitId) : undefined;
    if (line.unitId && !unit) errors[`lines.${i}.unitId`] = ["Choose an active unit"];
    const pricing: LineInput = {
      method: line.method,
      quantityMilli: line.quantityMilli,
      daysMilli: line.daysMilli,
      unitCostMinor: line.unitCostMinor,
      unitPriceMinor: line.unitPriceMinor,
      markupBps: line.markupBps,
      marginBps: line.marginBps,
      discountBps: line.discountBps,
      taxRateBps: tax?.rateBps ?? 0,
    };
    for (const issue of validateLine(pricing)) {
      (errors[`lines.${i}.${LINE_FIELD[issue.field]}`] ??= []).push(issue.message);
    }
    return { line, pricing, tax, unit };
  });
  if (Object.keys(errors).length)
    throw new ValidationError("Check the highlighted fields.", errors);

  const results = priced.map((p) => ({ ...p, result: priceLine(p.pricing) }));
  const totals = quoteTotals(
    results.map((r) => r.result),
    { contingencyBps: input.contingencyBps, contingencyTaxBps: headerTax?.rateBps ?? 0 },
  );

  return db.$transaction(async (tx) => {
    // Lock the version row so two saves can't interleave.
    const [locked] = await tx.$queryRaw<{ id: string; status: string; updatedAt: Date }[]>`
      SELECT id, status, "updatedAt" FROM quote_versions
      WHERE "quoteId" = ${quote.id}::uuid AND version = ${quote.currentVersion}
      FOR UPDATE`;
    if (!locked) throw new NotFoundError();
    if (locked.status !== "DRAFT") {
      throw new ConflictError("This version is no longer a draft. Create a revision to change it.");
    }
    if (
      input.expectedUpdatedAt &&
      new Date(input.expectedUpdatedAt).getTime() !== locked.updatedAt.getTime()
    ) {
      throw new ConflictError(
        "Someone else saved this quote while you were editing. Reload to see their changes.",
      );
    }
    const before = await tx.quoteVersion.findUniqueOrThrow({
      where: { id: locked.id },
      include: { lines: true },
    });
    const schedule =
      input.paymentTermId === before.paymentTermId
        ? null
        : input.paymentTermId
          ? await paymentSnapshot(tx, { id: input.paymentTermId })
          : { paymentTermId: null, paymentTermName: null, paymentSchedule: [] };
    if (input.paymentTermId && input.paymentTermId !== before.paymentTermId && !schedule) {
      throw invalid("paymentTermId", "Choose an active payment term");
    }

    await tx.quoteLine.deleteMany({ where: { versionId: before.id } });
    await tx.quoteLine.createMany({
      data: results.map(({ line, pricing, tax, unit, result }, position) => ({
        versionId: before.id,
        position,
        section: line.section,
        category: line.category,
        description: line.description,
        method: line.method,
        quantity: milliToDecimal(pricing.quantityMilli),
        days: milliToDecimal(pricing.daysMilli),
        unitId: unit?.id ?? null,
        unitCode: unit?.code ?? null,
        unitCostMinor: pricing.unitCostMinor,
        unitPriceMinor: result.unitPriceMinor,
        markupBps: line.markupBps,
        marginBps: line.marginBps,
        discountBps: line.discountBps,
        taxRateId: tax?.id ?? null,
        taxCode: tax?.code ?? null,
        taxRateBps: tax?.rateBps ?? 0,
        costMinor: result.costMinor,
        grossMinor: result.grossMinor,
        discountMinor: result.discountMinor,
        netMinor: result.netMinor,
        taxMinor: result.taxMinor,
        totalMinor: result.totalMinor,
      })),
    });
    const after = await tx.quoteVersion.update({
      where: { id: before.id },
      data: {
        contactId: input.contactId,
        currency: input.currency,
        fxRateToBase: input.fxRateToBase,
        fxNote: input.fxNote,
        validUntil: input.validUntil,
        ...(schedule ?? {}),
        taxRateId: headerTax?.id ?? null,
        taxRateBps: headerTax?.rateBps ?? 0,
        contingencyBps: input.contingencyBps,
        poRequired: input.poRequired,
        eventStartDate: input.eventStartDate,
        eventEndDate: input.eventEndDate,
        venue: input.venue,
        scope: input.scope,
        deliverables: input.deliverables,
        exclusions: input.exclusions,
        terms: input.terms,
        internalNotes: input.internalNotes,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        contingencyMinor: totals.contingencyMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        costMinor: totals.costMinor,
        marginBps: totals.marginBps,
      },
    });
    const titleChanged = input.title !== quote.title;
    if (titleChanged)
      await tx.quote.update({ where: { id: quote.id }, data: { title: input.title } });

    const changes = {
      ...(titleChanged ? { title: { from: quote.title, to: input.title } } : {}),
      ...diffChanges(before, after, VERSION_FIELDS),
    };
    const linesChanged = !(await sameLines(before.lines, results.length, () =>
      tx.quoteLine.findMany({ where: { versionId: before.id }, orderBy: { position: "asc" } }),
    ));
    if (Object.keys(changes).length || linesChanged) {
      await recordAudit(tx, actor, {
        action: "quote.draft_saved",
        targetType: "quote",
        targetId: quote.id,
        legalEntityId: quote.legalEntityId,
        changes: Object.keys(changes).length ? changes : undefined,
        metadata: {
          version: before.version,
          lines: { from: before.lines.length, to: results.length },
        },
      });
    }
    return after;
  });
}

const LINE_COMPARE = [
  "position",
  "section",
  "category",
  "description",
  "method",
  "quantity",
  "days",
  "unitId",
  "unitCostMinor",
  "unitPriceMinor",
  "markupBps",
  "marginBps",
  "discountBps",
  "taxRateId",
] as const;

/** Did a save leave the lines as they were? */
async function sameLines<L extends Record<(typeof LINE_COMPARE)[number], unknown>>(
  before: L[],
  count: number,
  load: () => Promise<L[]>,
) {
  if (before.length !== count) return false;
  const after = await load();
  const key = (l: L) => JSON.stringify(LINE_COMPARE.map((f) => String(l[f])));
  const sorted = [...before].sort((a, b) => Number(a.position) - Number(b.position));
  return sorted.every((l, i) => key(l) === key(after[i]!));
}

/**
 * Everything the client-facing quote document shows, and nothing internal:
 * cost, margin, markup and internal notes are always removed here.
 */
export async function getQuoteDocument(
  actor: Actor,
  id: string,
  options: { version?: number } = {},
) {
  const quote = await getQuote(actor, id, options);
  const [entity, client] = await Promise.all([
    db.legalEntity.findUniqueOrThrow({
      where: { id: quote.legalEntityId },
      include: { taxRegistrations: { where: { status: "ACTIVE" }, orderBy: { type: "asc" } } },
    }),
    db.client.findUniqueOrThrow({ where: { id: quote.clientId } }),
  ]);
  return {
    number: quote.number,
    title: quote.title,
    isDemo: quote.isDemo,
    isLatest: quote.isLatest,
    entity: {
      legalName: entity.legalName,
      tradingName: entity.tradingName,
      address: [
        entity.addressLine1,
        entity.addressLine2,
        entity.city,
        entity.region,
        entity.postalCode,
      ]
        .filter(Boolean)
        .join(", "),
      countryCode: entity.countryCode,
      taxRegistrations: entity.taxRegistrations.map((t) => ({ type: t.type, value: t.value })),
      timezone: entity.timezone,
    },
    client: {
      name: client.legalName ?? client.name,
      address: [
        client.addressLine1,
        client.addressLine2,
        client.city,
        client.region,
        client.postalCode,
      ]
        .filter(Boolean)
        .join(", "),
      taxId: client.taxId ? `${client.taxIdType ?? "Tax ID"} ${client.taxId}` : null,
    },
    version: hideCosts(quote.version),
  };
}
