import "server-only";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorizeEverywhere, can, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import {
  paymentTermInput,
  taxRateInput,
  unitInput,
  type PaymentTermInput,
  type TaxRateInput,
  type UnitInput,
} from "./schemas";

/*
 * Tax rates, payment terms and units are group-wide configuration, so changes
 * need an all-entities grant. Tax rates belong to Finance; payment terms and
 * units to Commercial. Anyone who works with quotes, finance or the
 * organisation can read them.
 */

const READERS: Permission[] = ["commercial.view", "finance.view", "organisation.view"];

export function canViewMasterData(actor: Actor): boolean {
  return READERS.some((p) => can(actor, p));
}

function authorizeRead(actor: Actor) {
  if (!canViewMasterData(actor)) throw new ForbiddenError();
}

type ListOptions = { includeArchived?: boolean };
const statusFilter = (o: ListOptions = {}) =>
  o.includeArchived ? {} : { status: "ACTIVE" as const };

// ─── Tax rates ───────────────────────────────────────────────────────────────

const TAX_FIELDS = ["countryCode", "code", "name", "rateBps", "treatment", "isDefault"] as const;

export async function listTaxRates(
  actor: Actor,
  options: ListOptions & { countryCode?: string } = {},
) {
  authorizeRead(actor);
  return db.taxRate.findMany({
    where: {
      ...statusFilter(options),
      ...(options.countryCode ? { countryCode: options.countryCode } : {}),
    },
    orderBy: [{ countryCode: "asc" }, { isDefault: "desc" }, { rateBps: "desc" }, { code: "asc" }],
  });
}

export async function createTaxRate(actor: Actor, input: TaxRateInput) {
  authorizeEverywhere(actor, "finance.configure");
  const { rate, ...data } = parseInput(taxRateInput, input);
  return withUniqueConflict(`${data.countryCode} already has a tax rate ${data.code}.`, () =>
    db.$transaction(async (tx) => {
      const hasDefault = await tx.taxRate.findFirst({
        where: { countryCode: data.countryCode, isDefault: true, status: "ACTIVE" },
      });
      // The first rate for a country becomes its default.
      const taxRate = await tx.taxRate.create({
        data: { ...data, rateBps: rate, isDefault: !hasDefault },
      });
      await recordAudit(tx, actor, {
        action: "tax_rate.created",
        targetType: "tax_rate",
        targetId: taxRate.id,
        changes: diffChanges(null, taxRate, TAX_FIELDS),
      });
      return taxRate;
    }),
  );
}

/** Makes this rate the default for its country, replacing the previous one. */
export async function setDefaultTaxRate(actor: Actor, id: string) {
  authorizeEverywhere(actor, "finance.configure");
  return db.$transaction(async (tx) => {
    const rate = await tx.taxRate.findUnique({ where: { id } });
    if (!rate) throw new NotFoundError();
    if (rate.status !== "ACTIVE") throw new ConflictError("Restore this rate before using it.");
    if (rate.isDefault) return rate;
    const previous = await tx.taxRate.findFirst({
      where: { countryCode: rate.countryCode, isDefault: true, status: "ACTIVE" },
    });
    if (previous)
      await tx.taxRate.update({ where: { id: previous.id }, data: { isDefault: false } });
    const after = await tx.taxRate.update({ where: { id }, data: { isDefault: true } });
    await recordAudit(tx, actor, {
      action: "tax_rate.default_set",
      targetType: "tax_rate",
      targetId: id,
      changes: diffChanges(rate, after, ["isDefault"]),
      metadata: { countryCode: rate.countryCode, previousDefault: previous?.code ?? null },
    });
    return after;
  });
}

export async function setTaxRateArchived(actor: Actor, id: string, archived: boolean) {
  authorizeEverywhere(actor, "finance.configure");
  return db.$transaction(async (tx) => {
    const rate = await tx.taxRate.findUnique({ where: { id } });
    if (!rate) throw new NotFoundError();
    const status = archived ? "ARCHIVED" : "ACTIVE";
    if (rate.status === status) return rate;
    if (archived && rate.isDefault) {
      throw new ConflictError("Make another rate the default for this country first.");
    }
    const after = await tx.taxRate.update({ where: { id }, data: { status, isDefault: false } });
    await recordAudit(tx, actor, {
      action: archived ? "tax_rate.archived" : "tax_rate.restored",
      targetType: "tax_rate",
      targetId: id,
      changes: diffChanges(rate, after, ["status"]),
    });
    return after;
  });
}

// ─── Payment terms ───────────────────────────────────────────────────────────

export async function listPaymentTerms(actor: Actor, options?: ListOptions) {
  authorizeRead(actor);
  return db.paymentTerm.findMany({
    where: statusFilter(options),
    include: { instalments: { orderBy: { position: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
  });
}

export async function createPaymentTerm(actor: Actor, input: PaymentTermInput) {
  authorizeEverywhere(actor, "commercial.configure");
  const { instalments, ...data } = parseInput(paymentTermInput, input);
  return withUniqueConflict(`A payment term with code ${data.code} already exists.`, () =>
    db.$transaction(async (tx) => {
      const hasDefault = await tx.paymentTerm.findFirst({
        where: { isDefault: true, status: "ACTIVE" },
      });
      const term = await tx.paymentTerm.create({
        data: {
          ...data,
          isDefault: !hasDefault,
          instalments: {
            create: instalments.map((i, position) => ({
              position,
              label: i.label,
              percentBps: i.percent,
              trigger: i.trigger,
              days: i.days,
            })),
          },
        },
        include: { instalments: { orderBy: { position: "asc" } } },
      });
      await recordAudit(tx, actor, {
        action: "payment_term.created",
        targetType: "payment_term",
        targetId: term.id,
        changes: {
          ...diffChanges(null, term, ["code", "name", "description", "isDefault"]),
          instalments: {
            from: null,
            to: term.instalments.map((i) => ({
              label: i.label,
              percentBps: i.percentBps,
              trigger: i.trigger,
              days: i.days,
            })),
          },
        },
      });
      return term;
    }),
  );
}

export async function setDefaultPaymentTerm(actor: Actor, id: string) {
  authorizeEverywhere(actor, "commercial.configure");
  return db.$transaction(async (tx) => {
    const term = await tx.paymentTerm.findUnique({ where: { id } });
    if (!term) throw new NotFoundError();
    if (term.status !== "ACTIVE") throw new ConflictError("Restore this term before using it.");
    if (term.isDefault) return term;
    const previous = await tx.paymentTerm.findFirst({
      where: { isDefault: true, status: "ACTIVE" },
    });
    if (previous) {
      await tx.paymentTerm.update({ where: { id: previous.id }, data: { isDefault: false } });
    }
    const after = await tx.paymentTerm.update({ where: { id }, data: { isDefault: true } });
    await recordAudit(tx, actor, {
      action: "payment_term.default_set",
      targetType: "payment_term",
      targetId: id,
      changes: diffChanges(term, after, ["isDefault"]),
      metadata: { previousDefault: previous?.code ?? null },
    });
    return after;
  });
}

export async function setPaymentTermArchived(actor: Actor, id: string, archived: boolean) {
  authorizeEverywhere(actor, "commercial.configure");
  return db.$transaction(async (tx) => {
    const term = await tx.paymentTerm.findUnique({ where: { id } });
    if (!term) throw new NotFoundError();
    const status = archived ? "ARCHIVED" : "ACTIVE";
    if (term.status === status) return term;
    if (archived && term.isDefault) {
      throw new ConflictError("Make another payment term the default first.");
    }
    const after = await tx.paymentTerm.update({
      where: { id },
      data: { status, isDefault: false },
    });
    await recordAudit(tx, actor, {
      action: archived ? "payment_term.archived" : "payment_term.restored",
      targetType: "payment_term",
      targetId: id,
      changes: diffChanges(term, after, ["status"]),
    });
    return after;
  });
}

// ─── Units ───────────────────────────────────────────────────────────────────

export async function listUnits(actor: Actor, options?: ListOptions) {
  authorizeRead(actor);
  return db.unit.findMany({ where: statusFilter(options), orderBy: { code: "asc" } });
}

export async function createUnit(actor: Actor, input: UnitInput) {
  authorizeEverywhere(actor, "commercial.configure");
  const data = parseInput(unitInput, input);
  return withUniqueConflict(`A unit with code ${data.code} already exists.`, () =>
    db.$transaction(async (tx) => {
      const unit = await tx.unit.create({ data });
      await recordAudit(tx, actor, {
        action: "unit.created",
        targetType: "unit",
        targetId: unit.id,
        changes: diffChanges(null, unit, ["code", "name"]),
      });
      return unit;
    }),
  );
}

export async function setUnitArchived(actor: Actor, id: string, archived: boolean) {
  authorizeEverywhere(actor, "commercial.configure");
  return db.$transaction(async (tx) => {
    const unit = await tx.unit.findUnique({ where: { id } });
    if (!unit) throw new NotFoundError();
    const status = archived ? "ARCHIVED" : "ACTIVE";
    if (unit.status === status) return unit;
    const after = await tx.unit.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "unit.archived" : "unit.restored",
      targetType: "unit",
      targetId: id,
      changes: diffChanges(unit, after, ["status"]),
    });
    return after;
  });
}
