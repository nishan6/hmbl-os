import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { recordAcceptance, recordDecline } from "@/server/commercial/acceptance";
import { lockLatest } from "@/server/commercial/workflow";
import { localToday } from "@/server/commercial/quotes";
import { invoiceSettlements } from "@/server/finance/invoices";
import { readFile } from "@/server/storage/files";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { paymentState } from "@/lib/invoice";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { authorizePortal, portalCaller, type PortalActor } from "./session";

/*
 * What a client's portal accounts see (docs/client-portal.md). Every read is
 * filtered by the account's client and by what has been shared with it, and
 * selects client-facing fields only: never costs, margins, budgets, crew
 * pay, supplier prices or internal notes.
 */

const live = { revokedAt: null } as const;

const uuid = z.uuid();

/** A malformed id names nothing this account can see. */
function known(id: string) {
  if (!uuid.safeParse(id).success) throw new NotFoundError();
  return id;
}

function clientOf(actor: PortalActor, permission: string) {
  authorizePortal(actor, "CLIENT", permission);
  return actor.clientId!;
}

// ─── Projects ────────────────────────────────────────────────────────────────

const projectSelect = {
  id: true,
  number: true,
  name: true,
  status: true,
  eventStartDate: true,
  eventEndDate: true,
  venue: true,
  currency: true,
} as const;

/** Statuses as a client reads them. */
export const CLIENT_PROJECT_STATUS: Record<string, string> = {
  DRAFT: "Being prepared",
  COMMERCIAL_REVIEW: "Being prepared",
  APPROVED: "Confirmed",
  PLANNING: "In planning",
  READY: "Ready",
  IN_PROGRESS: "Live",
  COMPLETED: "Completed",
  FINANCIAL_CLOSE: "Completed",
  CLOSED: "Completed",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
};

export async function listSharedProjects(actor: PortalActor) {
  const clientId = clientOf(actor, "projects.view");
  return db.project.findMany({
    where: { clientId, portalShares: { some: { clientId, ...live } } },
    orderBy: [{ eventStartDate: "desc" }, { number: "desc" }],
    select: projectSelect,
  });
}

export async function getSharedProject(actor: PortalActor, projectId: string) {
  const clientId = clientOf(actor, "projects.view");
  const project = await db.project.findFirst({
    where: { id: known(projectId), clientId, portalShares: { some: { clientId, ...live } } },
    select: {
      ...projectSelect,
      milestones: {
        orderBy: { position: "asc" },
        select: { id: true, label: true, amountMinor: true, dueDate: true },
      },
    },
  });
  if (!project) throw new NotFoundError();
  return project;
}

// ─── Requests ────────────────────────────────────────────────────────────────

const requestInput = z.object({ subject: requiredText(200), body: requiredText(5000) });

/** Sends HMBL information for a shared project. The project manager is told. */
export async function submitProjectInformation(
  actor: PortalActor,
  projectId: string,
  raw: z.input<typeof requestInput>,
) {
  authorizePortal(actor, "CLIENT", "requests.submit");
  const clientId = actor.clientId!;
  const project = await db.project.findFirst({
    where: { id: known(projectId), clientId, portalShares: { some: { clientId, ...live } } },
    select: { id: true, legalEntityId: true },
  });
  if (!project) throw new NotFoundError();
  const input = parseInput(requestInput, raw);
  return db.$transaction(async (tx) => {
    const submission = await tx.portalSubmission.create({
      data: { accountId: actor.accountId, projectId, subject: input.subject, body: input.body },
    });
    await recordAudit(tx, portalCaller(actor), {
      action: "portal_submission.created",
      targetType: "project",
      targetId: projectId,
      legalEntityId: project.legalEntityId,
      metadata: { submissionId: submission.id, subject: input.subject, via: "portal" },
    });
    return submission;
  });
}

export async function mySubmissions(actor: PortalActor, projectId: string) {
  authorizePortal(actor, "CLIENT", "requests.submit");
  return db.portalSubmission.findMany({
    where: { projectId: known(projectId), account: { clientId: actor.clientId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, subject: true, body: true, createdAt: true },
  });
}

// ─── Quotations ──────────────────────────────────────────────────────────────

/** Version statuses a client may see: ones HMBL sent them. */
const SENT = ["ISSUED", "ACCEPTED", "DECLINED", "SUPERSEDED", "WITHDRAWN"] as const;

const versionSelect = {
  id: true,
  version: true,
  status: true,
  currency: true,
  validUntil: true,
  issuedAt: true,
  paymentTermName: true,
  paymentSchedule: true,
  poRequired: true,
  eventStartDate: true,
  eventEndDate: true,
  venue: true,
  scope: true,
  deliverables: true,
  exclusions: true,
  terms: true,
  subtotalMinor: true,
  discountMinor: true,
  contingencyBps: true,
  contingencyMinor: true,
  taxMinor: true,
  totalMinor: true,
  acceptedOn: true,
  acceptedByName: true,
  declinedAt: true,
  lines: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      section: true,
      category: true,
      method: true,
      description: true,
      quantity: true,
      days: true,
      unitCode: true,
      unitPriceMinor: true,
      discountBps: true,
      netMinor: true,
      taxCode: true,
      taxRateBps: true,
      taxMinor: true,
      totalMinor: true,
    },
  },
  portalResponse: {
    select: { response: true, typedName: true, createdAt: true, contentSha256: true },
  },
} as const;

/** A fingerprint of exactly what the client is shown for a version. */
export function quoteContentHash(version: object) {
  const canonical = JSON.stringify(version, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return createHash("sha256").update(canonical).digest("hex");
}

function fingerprinted<V extends { portalResponse: unknown; status: string }>(v: V) {
  // The answer itself and the status it causes aren't part of what was offered.
  const { portalResponse: _r, status: _s, ...offered } = v;
  void _r;
  void _s;
  return quoteContentHash(offered);
}

export async function listSharedQuotes(actor: PortalActor) {
  const clientId = clientOf(actor, "quotes.respond");
  const quotes = await db.quote.findMany({
    where: { clientId, portalShares: { some: { clientId, ...live } } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      title: true,
      versions: {
        where: { status: { in: [...SENT] } },
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, status: true, currency: true, totalMinor: true, validUntil: true },
      },
    },
  });
  return quotes
    .filter((q) => q.versions.length)
    .map(({ versions, ...q }) => ({ ...q, latest: versions[0]! }));
}

async function loadSharedQuote(actor: PortalActor, quoteId: string) {
  const clientId = clientOf(actor, "quotes.respond");
  const quote = await db.quote.findFirst({
    where: { id: known(quoteId), clientId, portalShares: { some: { clientId, ...live } } },
    include: { legalEntity: true },
  });
  if (!quote) throw new NotFoundError();
  return quote;
}

/** The latest version HMBL sent, as the client sees it, and whether they can answer it now. */
export async function getSharedQuote(actor: PortalActor, quoteId: string) {
  const quote = await loadSharedQuote(actor, quoteId);
  const version = await db.quoteVersion.findFirst({
    where: { quoteId, status: { in: [...SENT] } },
    orderBy: { version: "desc" },
    select: versionSelect,
  });
  if (!version) throw new NotFoundError();
  const today = localToday(quote.legalEntity.timezone);
  const current = version.version === quote.currentVersion;
  const answerable = current && version.status === "ISSUED";
  return {
    id: quote.id,
    number: quote.number,
    title: quote.title,
    entityName: quote.legalEntity.tradingName ?? quote.legalEntity.legalName,
    version,
    contentSha256: fingerprinted(version),
    canRespond: answerable && version.validUntil >= today,
    expired: answerable && version.validUntil < today,
    // A newer version is being prepared; this one can't be answered.
    revising: !current,
  };
}

/** What the client confirms, word for word, when accepting. Not an electronic signature. */
export function acceptanceStatement(
  name: string,
  quote: { number: string; version: number },
  entity: string,
) {
  return (
    `I, ${name}, accept quotation ${quote.number} version ${quote.version} from ${entity} ` +
    `on behalf of my organisation, on the terms shown. I understand this records my acceptance; ` +
    `it is not an electronic signature.`
  );
}

const respondInput = z.discriminatedUnion("response", [
  z.object({
    response: z.literal("ACCEPTED"),
    typedName: requiredText(200),
    clientPoNumber: optionalText(100),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    confirm: z.boolean().refine((v) => v, "Tick the box to confirm"),
  }),
  z.object({
    response: z.literal("DECLINED"),
    typedName: requiredText(200),
    reason: requiredText(1000),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);
export type RespondInput = z.input<typeof respondInput>;

/**
 * The client accepts or declines the issued version in the portal. Records
 * who, when, from where, which version and a fingerprint of what they saw;
 * acceptance then creates the project exactly as when staff record it.
 */
export async function respondToQuote(actor: PortalActor, quoteId: string, raw: RespondInput) {
  const quote = await loadSharedQuote(actor, quoteId);
  const input = parseInput(respondInput, raw);
  const caller = portalCaller(actor);
  return db.$transaction(async (tx) => {
    const locked = await lockLatest(tx, quote, ["ISSUED"]);
    const shown = await tx.quoteVersion.findUniqueOrThrow({
      where: { id: locked.id },
      select: versionSelect,
    });
    const hash = fingerprinted(shown);
    if (hash !== input.contentSha256) {
      throw new ConflictError("This quotation changed while you were reading it. Review it again.");
    }
    const today = localToday(quote.legalEntity.timezone);
    if (locked.validUntil < today) {
      throw new ConflictError("This quotation has expired. Ask HMBL to issue it again.");
    }
    const entity = quote.legalEntity.tradingName ?? quote.legalEntity.legalName;
    const statement =
      input.response === "ACCEPTED"
        ? acceptanceStatement(
            input.typedName,
            { number: quote.number, version: locked.version },
            entity,
          )
        : `${input.typedName} declined quotation ${quote.number} version ${locked.version}.`;
    if (input.response === "ACCEPTED" && locked.poRequired && !input.clientPoNumber) {
      throw new ValidationError("Check the highlighted fields", {
        clientPoNumber: ["This quotation needs your purchase order number"],
      });
    }
    const response = await tx.quotePortalResponse.create({
      data: {
        versionId: locked.id,
        accountId: actor.accountId,
        userId: actor.id,
        response: input.response,
        typedName: input.typedName,
        reason: input.response === "DECLINED" ? input.reason : null,
        clientPoNumber: input.response === "ACCEPTED" ? input.clientPoNumber : null,
        currency: locked.currency,
        totalMinor: locked.totalMinor,
        contentSha256: hash,
        statement,
        ipAddress: actor.request?.ipAddress ?? null,
        userAgent: actor.request?.userAgent ?? null,
      },
    });
    const evidence = { via: "portal", portalResponseId: response.id, contentSha256: hash };
    const owner = quote.ownerId ?? quote.createdById;
    if (input.response === "DECLINED") {
      await recordDecline(tx, caller, quote, locked, input.reason, evidence);
      return { response: "DECLINED" as const, projectId: null, notify: owner };
    }
    const project = await recordAcceptance(
      tx,
      caller,
      quote,
      locked,
      {
        acceptedOn: today,
        acceptedByName: input.typedName,
        acceptanceMethod: "PORTAL",
        clientPoNumber: input.clientPoNumber,
        acceptanceNotes: null,
      },
      { projectCreatedById: owner, audit: evidence },
    );
    return { response: "ACCEPTED" as const, projectId: project.id, notify: owner };
  });
}

// ─── Invoices ────────────────────────────────────────────────────────────────

const invoiceListSelect = {
  id: true,
  kind: true,
  number: true,
  invoiceDate: true,
  dueDate: true,
  currency: true,
  totalMinor: true,
  project: { select: { number: true, name: true } },
} as const;

/** Every invoice HMBL issued to this client, with what is still due. */
export async function listClientInvoices(actor: PortalActor, now = new Date()) {
  const clientId = clientOf(actor, "invoices.view");
  const invoices = await db.salesInvoice.findMany({
    where: { clientId, status: "ISSUED" },
    orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
    select: invoiceListSelect,
  });
  const settled = await invoiceSettlements(
    db,
    invoices.filter((i) => i.kind === "TAX").map((i) => i.id),
  );
  return invoices.map((inv) => {
    const s = settled.get(inv.id);
    return {
      ...inv,
      paidMinor: s?.paidMinor ?? 0n,
      creditedMinor: s?.creditedMinor ?? 0n,
      outstandingMinor: s ? inv.totalMinor - s.paidMinor - s.creditedMinor : null,
      state: s ? paymentState(inv, s, now) : null,
    };
  });
}

/** One issued invoice as the client received it, with where to pay. */
export async function getClientInvoice(actor: PortalActor, invoiceId: string) {
  const clientId = clientOf(actor, "invoices.view");
  const inv = await db.salesInvoice.findFirst({
    where: { id: known(invoiceId), clientId, status: "ISSUED" },
    select: {
      ...invoiceListSelect,
      clientName: true,
      clientAddress: true,
      clientGstin: true,
      entityGstin: true,
      clientPoNumber: true,
      supplyType: true,
      placeOfSupplyCode: true,
      placeOfSupplyCountry: true,
      notes: true,
      subtotalMinor: true,
      cgstMinor: true,
      sgstMinor: true,
      igstMinor: true,
      otherTaxMinor: true,
      taxMinor: true,
      isDemo: true,
      legalEntity: {
        select: {
          id: true,
          legalName: true,
          tradingName: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          countryCode: true,
          isDemo: true,
        },
      },
      lines: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          description: true,
          sacCode: true,
          quantity: true,
          unitPriceMinor: true,
          amountMinor: true,
          taxRateBps: true,
          cgstMinor: true,
          sgstMinor: true,
          igstMinor: true,
          otherTaxMinor: true,
          totalMinor: true,
        },
      },
    },
  });
  if (!inv) throw new NotFoundError();
  const bankAccounts = await db.bankAccount.findMany({
    where: {
      legalEntityId: inv.legalEntity.id,
      currency: inv.currency,
      showOnInvoices: true,
      status: "ACTIVE",
    },
    select: {
      id: true,
      bankName: true,
      branch: true,
      accountName: true,
      accountNumber: true,
      ifsc: true,
      swift: true,
      iban: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return { invoice: inv, bankAccounts };
}

// ─── Documents ───────────────────────────────────────────────────────────────

/**
 * The newest version of a shared document that the client may still see:
 * a later version replaces it unless restricted; archived means gone.
 */
async function latestVisible(documentId: string) {
  let doc = await db.recordDocument.findUnique({
    where: { id: documentId },
    include: { nextVersion: { select: { id: true } } },
  });
  while (doc?.nextVersion) {
    const next = await db.recordDocument.findUnique({
      where: { id: doc.nextVersion.id },
      include: { nextVersion: { select: { id: true } } },
    });
    if (!next || next.access !== "STANDARD") break;
    doc = next;
  }
  if (!doc || doc.access !== "STANDARD" || doc.archivedAt) return null;
  return doc;
}

export async function listSharedDocuments(actor: PortalActor) {
  const clientId = clientOf(actor, "documents.view");
  const shares = await db.portalShare.findMany({
    where: { clientId, kind: "DOCUMENT", ...live },
    orderBy: { createdAt: "desc" },
    select: { id: true, documentId: true, createdAt: true },
  });
  const docs = await Promise.all(shares.map((s) => latestVisible(s.documentId!)));
  return shares.flatMap((s, i) => {
    const d = docs[i];
    return d
      ? [
          {
            shareId: s.id,
            title: d.title,
            fileName: d.fileName,
            category: d.category,
            sizeBytes: d.sizeBytes,
            version: d.version,
            uploadedAt: d.uploadedAt,
          },
        ]
      : [];
  });
}

/** A shared document's file, by share, for download. */
export async function openSharedDocument(actor: PortalActor, shareId: string) {
  const clientId = clientOf(actor, "documents.view");
  const share = await db.portalShare.findFirst({
    where: { id: known(shareId), clientId, kind: "DOCUMENT", ...live },
  });
  if (!share) throw new NotFoundError();
  const doc = await latestVisible(share.documentId!);
  if (!doc) throw new NotFoundError();
  return { doc, file: await readFile(doc.storageKey) };
}

/** What the client home page counts. Only what this account may see. */
export async function clientOverview(actor: PortalActor) {
  const has = (p: string) => actor.permissions.has(p);
  const [projects, quotes, invoices, documents] = await Promise.all([
    has("projects.view") ? listSharedProjects(actor) : null,
    has("quotes.respond") ? listSharedQuotes(actor) : null,
    has("invoices.view") ? listClientInvoices(actor) : null,
    has("documents.view") ? listSharedDocuments(actor) : null,
  ]);
  return { projects, quotes, invoices, documents };
}
