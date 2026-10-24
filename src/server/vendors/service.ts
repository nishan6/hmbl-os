import "server-only";
import { z } from "zod";
import type { VendorKind } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { normalizeClientName } from "@/server/crm/normalize";
import { can, type Actor } from "@/server/permissions/authorize";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isGstin } from "@/lib/gst";
import { parseInput } from "@/lib/parse";
import { parsePercentToBps } from "@/lib/percent";
import { countryCodeSchema, currencySchema, optionalText, requiredText } from "@/lib/validation";

/*
 * Vendors: the suppliers HMBL buys from (docs/payables.md, docs/procurement.md).
 * Shared by every entity, like clients. Finance and procurement both keep
 * them, but only Finance changes how a vendor is paid: bank details and TDS.
 * Bank details are shown only to Finance and to `procurement.view_sensitive`.
 */

export const VENDOR_KINDS: Record<VendorKind, string> = {
  COMPANY: "Company",
  INDIVIDUAL: "Individual (freelancer)",
};

const FIELDS = [
  "name",
  "legalName",
  "kind",
  "email",
  "phone",
  "gstin",
  "pan",
  "msmeNumber",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "countryCode",
  "currency",
  "paymentTermsDays",
  "tdsSection",
  "tdsRateBps",
  "bankAccountName",
  "bankAccountNumber",
  "bankIfsc",
  "notes",
  "status",
] as const;

/** Fields only Finance sets: where the money goes, and the tax withheld from it. */
const PAYMENT_FIELDS = [
  "tdsSection",
  "tdsRateBps",
  "bankAccountName",
  "bankAccountNumber",
  "bankIfsc",
] as const;

type BankField = "bankAccountName" | "bankAccountNumber" | "bankIfsc";

/** The payment fields of a vendor, or all null. */
function pick(
  from: Partial<Record<(typeof PAYMENT_FIELDS)[number], unknown>>,
  fields: typeof PAYMENT_FIELDS,
) {
  return Object.fromEntries(fields.map((f) => [f, from[f] ?? null]));
}

function canRead(actor: Actor) {
  return can(actor, "finance.view") || can(actor, "procurement.view");
}

function requireRead(actor: Actor) {
  if (!canRead(actor)) throw new ForbiddenError();
}

/** Whether the actor may see a vendor's bank details. */
export function canSeeBankDetails(actor: Actor) {
  return can(actor, "finance.view") || can(actor, "procurement.view_sensitive");
}

/** Whether the actor may change a vendor's bank details and TDS. */
export function canEditPaymentDetails(actor: Actor) {
  return can(actor, "finance.edit");
}

function redact<T extends Record<BankField, string | null>>(actor: Actor, vendor: T): T {
  if (canSeeBankDetails(actor)) return vendor;
  return { ...vendor, bankAccountName: null, bankAccountNumber: null, bankIfsc: null };
}

const upper = (v: string | null) => (v ? v.toUpperCase().replace(/\s+/g, "") : null);

const vendorInput = z.object({
  name: requiredText(200),
  legalName: optionalText(200),
  kind: z.enum(["COMPANY", "INDIVIDUAL"]).default("COMPANY"),
  email: optionalText(200),
  phone: optionalText(50),
  gstin: optionalText(15)
    .transform(upper)
    .refine((v) => !v || isGstin(v), "Use a 15-character GSTIN, such as 18AABCH1234K1Z5"),
  pan: optionalText(10)
    .transform(upper)
    .refine(
      (v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v),
      "Use a 10-character PAN, such as AABCH1234K",
    ),
  msmeNumber: optionalText(30).transform(upper),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  countryCode: countryCodeSchema,
  currency: currencySchema,
  paymentTermsDays: z.coerce
    .number({ message: "Enter a number of days" })
    .int("Enter whole days")
    .min(0, "Enter zero or more days")
    .max(365, "Use at most 365 days"),
  tdsSection: optionalText(10).transform(upper),
  tdsRate: optionalText(10),
  bankAccountName: optionalText(200),
  bankAccountNumber: optionalText(34),
  bankIfsc: optionalText(11)
    .transform(upper)
    .refine((v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Use an 11-character IFSC"),
  notes: optionalText(2000),
});
export type VendorInput = z.input<typeof vendorInput>;

function toData(raw: VendorInput) {
  const { tdsRate, ...data } = parseInput(vendorInput, raw);
  let tdsRateBps: number | null = null;
  if (tdsRate) {
    tdsRateBps = parsePercentToBps(tdsRate);
    if (tdsRateBps === null || tdsRateBps > 3000) {
      throw new ValidationError("Check the highlighted fields.", {
        tdsRate: ["Enter a rate such as 2 or 10"],
      });
    }
  }
  if (data.pan && data.gstin && data.gstin.slice(2, 12) !== data.pan) {
    throw new ValidationError("Check the highlighted fields.", {
      pan: ["The PAN doesn't match the one inside the GSTIN"],
    });
  }
  return {
    ...data,
    // A GSTIN carries the PAN in characters 3 to 12.
    pan: data.pan ?? (data.gstin ? data.gstin.slice(2, 12) : null),
    tdsRateBps,
    normalizedName: normalizeClientName(data.name),
  };
}

export async function listVendors(
  actor: Actor,
  options: { search?: string; includeArchived?: boolean } = {},
) {
  requireRead(actor);
  const q = options.search?.trim();
  const vendors = await db.vendor.findMany({
    where: {
      ...(options.includeArchived ? {} : { status: "ACTIVE" }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { legalName: { contains: q, mode: "insensitive" } },
              { normalizedName: { contains: normalizeClientName(q) } },
              { gstin: { equals: q.toUpperCase() } },
              { pan: { equals: q.toUpperCase() } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 500,
  });
  return vendors.map((v) => redact(actor, v));
}

export async function getVendor(actor: Actor, id: string) {
  requireRead(actor);
  const vendor = await db.vendor.findUnique({ where: { id } });
  if (!vendor) throw new NotFoundError();
  return redact(actor, vendor);
}

/** Active vendors for pickers. */
export async function vendorOptions(actor: Actor) {
  requireRead(actor);
  return db.vendor.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      currency: true,
      paymentTermsDays: true,
      tdsSection: true,
      tdsRateBps: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function createVendor(actor: Actor, raw: VendorInput) {
  const finance = can(actor, "finance.create");
  if (!finance && !can(actor, "procurement.create")) throw new ForbiddenError();
  const data = toData(raw);
  if (!finance) Object.assign(data, pick({}, PAYMENT_FIELDS));
  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.create({ data });
    await recordAudit(tx, actor, {
      action: "vendor.created",
      targetType: "vendor",
      targetId: vendor.id,
      changes: diffChanges(null, vendor, FIELDS),
    });
    return vendor;
  });
}

export async function updateVendor(actor: Actor, id: string, raw: VendorInput) {
  if (!can(actor, "finance.edit") && !can(actor, "procurement.edit")) throw new ForbiddenError();
  requireRead(actor);
  const before = await db.vendor.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const data = toData(raw);
  // Without finance.edit, how the vendor is paid stays as it was.
  if (!canEditPaymentDetails(actor)) Object.assign(data, pick(before, PAYMENT_FIELDS));
  return db.$transaction(async (tx) => {
    const after = await tx.vendor.update({ where: { id }, data });
    const changes = diffChanges(before, after, FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "vendor.updated",
        targetType: "vendor",
        targetId: id,
        changes,
      });
    }
    return after;
  });
}

export async function setVendorArchived(actor: Actor, id: string, archived: boolean) {
  if (!can(actor, "finance.edit") && !can(actor, "procurement.archive")) {
    throw new ForbiddenError();
  }
  const before = await getVendor(actor, id);
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  return db.$transaction(async (tx) => {
    const after = await tx.vendor.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "vendor.archived" : "vendor.restored",
      targetType: "vendor",
      targetId: id,
      changes: { status: { from: before.status, to: status } },
    });
    return after;
  });
}
