import "server-only";
import { db } from "@/server/db";
import { clientInput, type ClientInput } from "@/server/crm/schemas";
import {
  createClient,
  findPossibleDuplicates,
  getClient,
  updateClient,
} from "@/server/crm/clients";
import { normalizeClientName, websiteDomain } from "@/server/crm/normalize";
import {
  createCrewMember,
  memberInput,
  updateCrewMember,
  type CrewMemberInput,
} from "@/server/crew/members";
import { createItem, itemData, updateItem, type ItemInput } from "@/server/equipment/inventory";
import { can, type Actor } from "@/server/permissions/authorize";
import { createVendor, updateVendor, vendorData, type VendorInput } from "@/server/vendors/service";
import { ValidationError } from "@/lib/errors";
import type { ImportKind } from "@/lib/imports";
import { minorToInput } from "@/lib/money";
import { parseInput } from "@/lib/parse";

/*
 * How each kind of record is checked, matched against what exists, and
 * written. Writing always goes through the module's own service, so an
 * imported record passes the same rules, permissions and audit as one typed
 * in. Checking never writes.
 */

export type Errors = Record<string, string[]>;
export type Match = { id: string; label: string; reason: string; canCreate: boolean };

export type Checked =
  { ok: true; input: Record<string, unknown>; keys: string[] } | { ok: false; errors: Errors };

export type Adapter = {
  /** Permission to import new records of this kind. */
  canCreate(actor: Actor): boolean;
  /** Permission to update existing ones from a file. */
  canUpdate(actor: Actor): boolean;
  /** The service input for a row, fully checked; `keys` find the same record twice in one file. */
  check(actor: Actor, fields: Record<string, string>): Promise<Checked>;
  /** An existing record this row looks like. */
  match(actor: Actor, input: Record<string, unknown>): Promise<Match | null>;
  create(actor: Actor, input: Record<string, unknown>, duplicate: boolean): Promise<{ id: string }>;
  /** Fills the existing record's fields from the row's non-blank values. */
  update(actor: Actor, id: string, input: Record<string, unknown>): Promise<{ id: string }>;
};

const blank = (v: string) => (v === "" ? null : v);

/** Runs a form's own check; on failure, its errors under the import's field names. */
async function attempt<T>(
  run: () => T | Promise<T>,
  rename: Record<string, string> = {},
): Promise<{ value: T; errors: null } | { value: null; errors: Errors }> {
  try {
    return { value: await run(), errors: null };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const errors: Errors = {};
    const entries = Object.entries(error.fieldErrors);
    if (!entries.length) errors._row = [error.message];
    for (const [key, messages] of entries) {
      const field = rename[key] ?? key;
      errors[field] = [...(errors[field] ?? []), ...messages];
    }
    return { value: null, errors };
  }
}

/** Existing values overlaid with the row's non-blank ones. */
function overlay<T extends Record<string, unknown>>(existing: T, input: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return out as T;
}

function choice<T extends string>(
  value: string,
  options: Record<string, T>,
  field: string,
  message: string,
  errors: Errors,
): T | undefined {
  if (!value) return undefined;
  const found = options[value.toLowerCase()];
  if (!found) errors[field] = [message];
  return found;
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PARTY_KINDS = { company: "COMPANY", individual: "INDIVIDUAL", person: "INDIVIDUAL" } as const;

// ─── Clients ─────────────────────────────────────────────────────────────────

const clients: Adapter = {
  canCreate: (actor) => can(actor, "crm.create"),
  canUpdate: (actor) => can(actor, "crm.edit"),
  async check(_actor, f) {
    const errors: Errors = {};
    const kind = choice(f.kind!, PARTY_KINDS, "kind", "Use Company or Individual", errors);
    const taxId = blank(f.taxId!);
    // A tax ID that is a GSTIN needs no type column.
    const taxIdType =
      blank(f.taxIdType!) ??
      (taxId && GSTIN.test(taxId.toUpperCase().replace(/\s+/g, "")) ? "GSTIN" : null);
    const raw: ClientInput = {
      name: f.name!,
      legalName: blank(f.legalName!),
      kind,
      industry: blank(f.industry!),
      website: blank(f.website!),
      email: blank(f.email!),
      phone: blank(f.phone!),
      taxIdType,
      taxId,
      addressLine1: blank(f.addressLine1!),
      addressLine2: blank(f.addressLine2!),
      city: blank(f.city!),
      region: blank(f.region!),
      postalCode: blank(f.postalCode!),
      countryCode: f.countryCode!,
      currency: f.currency!,
      invoiceCode: blank(f.invoiceCode!),
      notes: blank(f.notes!),
    };
    const { value: data, errors: problems } = await attempt(() => parseInput(clientInput, raw));
    Object.assign(errors, problems);
    if (data?.invoiceCode) {
      const code = data.invoiceCode;
      const holder = await db.client.findFirst({
        where: { invoiceCode: code, status: "ACTIVE" },
        select: { name: true },
      });
      if (holder) errors.invoiceCode = [`${holder.name} already uses ${code}`];
    }
    if (Object.keys(errors).length || !data) return { ok: false, errors };
    return {
      ok: true,
      input: raw as Record<string, unknown>,
      keys: [
        `name:${normalizeClientName(data.name)}`,
        ...(data.taxId ? [`tax:${data.taxId}`] : []),
        ...(data.invoiceCode ? [`code:${data.invoiceCode}`] : []),
      ],
    };
  },
  async match(actor, input) {
    const i = input as ClientInput;
    const [m] = await findPossibleDuplicates(actor, {
      name: i.name,
      taxId: i.taxId ? String(i.taxId).toUpperCase().replace(/\s+/g, "") : null,
      website: i.website ?? null,
    });
    if (!m) return null;
    const sameTax = Boolean(
      i.taxId && m.taxId === String(i.taxId).toUpperCase().replace(/\s+/g, ""),
    );
    const reason = sameTax
      ? "Same tax ID"
      : m.normalizedName === normalizeClientName(i.name)
        ? "Same name"
        : `Same website (${websiteDomain(m.website)})`;
    // An active client already holds the tax ID, so a second can't be created.
    return { id: m.id, label: m.name, reason, canCreate: !sameTax };
  },
  create: (actor, input, duplicate) =>
    createClient(actor, { ...(input as ClientInput), allowDuplicate: duplicate }),
  async update(actor, id, input) {
    const c = await getClient(actor, id);
    const existing: ClientInput = {
      name: c.name,
      legalName: c.legalName,
      kind: c.kind,
      industry: c.industry,
      website: c.website,
      email: c.email,
      phone: c.phone,
      taxIdType: c.taxIdType,
      taxId: c.taxId,
      addressLine1: c.addressLine1,
      addressLine2: c.addressLine2,
      city: c.city,
      region: c.region,
      postalCode: c.postalCode,
      countryCode: c.countryCode,
      currency: c.currency,
      invoiceCode: c.invoiceCode,
      ownerId: c.ownerId,
      notes: c.notes,
    };
    return updateClient(actor, id, overlay(existing, input));
  },
};

// ─── Vendors ─────────────────────────────────────────────────────────────────

const vendors: Adapter = {
  canCreate: (actor) => can(actor, "finance.create") || can(actor, "procurement.create"),
  canUpdate: (actor) => can(actor, "finance.edit") || can(actor, "procurement.edit"),
  async check(actor, f) {
    const errors: Errors = {};
    const kind = choice(f.kind!, PARTY_KINDS, "kind", "Use Company or Individual", errors);
    const raw: VendorInput = {
      name: f.name!,
      legalName: blank(f.legalName!),
      kind,
      email: blank(f.email!),
      phone: blank(f.phone!),
      gstin: blank(f.gstin!),
      pan: blank(f.pan!),
      msmeNumber: blank(f.msmeNumber!),
      addressLine1: blank(f.addressLine1!),
      addressLine2: blank(f.addressLine2!),
      city: blank(f.city!),
      region: blank(f.region!),
      postalCode: blank(f.postalCode!),
      countryCode: f.countryCode!,
      currency: f.currency!,
      paymentTermsDays: f.paymentTermsDays || "30",
      tdsSection: blank(f.tdsSection!),
      tdsRate: blank(f.tdsRate!),
      notes: blank(f.notes!),
    };
    // Without Finance the vendor service would drop these; say so instead.
    if (!can(actor, "finance.create")) {
      if (raw.tdsSection) errors.tdsSection = ["Only Finance can set TDS; leave it blank"];
      if (raw.tdsRate) errors.tdsRate = ["Only Finance can set TDS; leave it blank"];
    }
    const { value: data, errors: problems } = await attempt(() => vendorData(raw));
    Object.assign(errors, problems);
    if (Object.keys(errors).length || !data) return { ok: false, errors };
    return {
      ok: true,
      // Blank terms: 30 days for a new vendor, unchanged for an existing one.
      input: { ...raw, paymentTermsDays: blank(f.paymentTermsDays!) },
      keys: [`name:${data.normalizedName}`, ...(data.gstin ? [`gstin:${data.gstin}`] : [])],
    };
  },
  async match(_actor, input) {
    const d = vendorData({ ...(input as VendorInput), paymentTermsDays: "30" });
    const m = await db.vendor.findFirst({
      where: {
        status: "ACTIVE",
        OR: [
          { normalizedName: d.normalizedName },
          ...(d.gstin ? [{ gstin: d.gstin }] : []),
          ...(d.pan ? [{ pan: d.pan }] : []),
        ],
      },
      select: { id: true, name: true, normalizedName: true, gstin: true, pan: true },
    });
    if (!m) return null;
    const reason =
      d.gstin && m.gstin === d.gstin
        ? "Same GSTIN"
        : d.pan && m.pan === d.pan
          ? "Same PAN"
          : "Same name";
    return { id: m.id, label: m.name, reason, canCreate: true };
  },
  create: (actor, input) =>
    createVendor(actor, {
      ...(input as VendorInput),
      paymentTermsDays: (input as VendorInput).paymentTermsDays ?? "30",
    }),
  async update(actor, id, input) {
    const v = await db.vendor.findUniqueOrThrow({ where: { id } });
    const existing: VendorInput = {
      name: v.name,
      legalName: v.legalName,
      kind: v.kind,
      email: v.email,
      phone: v.phone,
      gstin: v.gstin,
      pan: v.pan,
      msmeNumber: v.msmeNumber,
      addressLine1: v.addressLine1,
      addressLine2: v.addressLine2,
      city: v.city,
      region: v.region,
      postalCode: v.postalCode,
      countryCode: v.countryCode,
      currency: v.currency,
      paymentTermsDays: String(v.paymentTermsDays),
      tdsSection: v.tdsSection,
      tdsRate: v.tdsRateBps === null ? null : String(v.tdsRateBps / 100),
      // Bank details are never imported; keep what is there.
      bankAccountName: v.bankAccountName,
      bankAccountNumber: v.bankAccountNumber,
      bankIfsc: v.bankIfsc,
      notes: v.notes,
    };
    return updateVendor(actor, id, overlay(existing, input));
  },
};

// ─── Crew ────────────────────────────────────────────────────────────────────

const CREW_KINDS = {
  staff: "EMPLOYEE",
  employee: "EMPLOYEE",
  freelancer: "FREELANCER",
  freelance: "FREELANCER",
} as const;

const crew: Adapter = {
  canCreate: (actor) => can(actor, "crew.create"),
  canUpdate: (actor) => can(actor, "crew.edit"),
  async check(_actor, f) {
    const errors: Errors = {};
    const kind = choice(f.kind!, CREW_KINDS, "kind", "Use Staff or Freelancer", errors);
    const raw = {
      name: f.name!,
      kind,
      email: blank(f.email!),
      phone: blank(f.phone!),
      baseCity: blank(f.baseCity!),
      preferredLocations: blank(f.preferredLocations!),
      skills: blank(f.skills!),
      contractRef: blank(f.contractRef!),
      notes: blank(f.notes!),
    } as CrewMemberInput;
    Object.assign(errors, (await attempt(() => parseInput(memberInput, raw))).errors);
    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      input: raw as Record<string, unknown>,
      keys: [
        `name:${normalizeClientName(raw.name)}`,
        ...(raw.email ? [`email:${raw.email.toLowerCase()}`] : []),
      ],
    };
  },
  async match(_actor, input) {
    const i = input as CrewMemberInput;
    const m = await db.crewMember.findFirst({
      where: {
        status: "ACTIVE",
        OR: [
          { normalizedName: normalizeClientName(i.name) },
          ...(i.email ? [{ email: { equals: i.email, mode: "insensitive" as const } }] : []),
          ...(i.phone ? [{ phone: i.phone }] : []),
        ],
      },
      select: { id: true, name: true, email: true, phone: true, normalizedName: true },
    });
    if (!m) return null;
    const reason =
      i.email && m.email?.toLowerCase() === i.email.toLowerCase()
        ? "Same email"
        : i.phone && m.phone === i.phone
          ? "Same phone"
          : "Same name";
    return { id: m.id, label: m.name, reason, canCreate: true };
  },
  create: (actor, input) => createCrewMember(actor, input as CrewMemberInput),
  async update(actor, id, input) {
    const m = await db.crewMember.findUniqueOrThrow({ where: { id } });
    const existing: CrewMemberInput = {
      name: m.name,
      kind: m.kind,
      userId: m.userId,
      vendorId: m.vendorId,
      email: m.email,
      phone: m.phone,
      baseCity: m.baseCity,
      preferredLocations: m.preferredLocations,
      skills: m.skills.join(", "),
      contractRef: m.contractRef,
      notes: m.notes,
      emergencyContactName: m.emergencyContactName,
      emergencyContactPhone: m.emergencyContactPhone,
      emergencyContactRelation: m.emergencyContactRelation,
    };
    return updateCrewMember(actor, id, overlay(existing, input));
  },
};

// ─── Equipment items ─────────────────────────────────────────────────────────

const TRACKING = {
  serialised: "SERIALISED",
  serialized: "SERIALISED",
  serial: "SERIALISED",
  quantity: "QUANTITY",
  bulk: "QUANTITY",
} as const;

const equipment: Adapter = {
  canCreate: (actor) => can(actor, "equipment.create"),
  canUpdate: (actor) => can(actor, "equipment.edit"),
  async check(_actor, f) {
    const errors: Errors = {};
    const tracking = choice(
      f.tracking!,
      TRACKING,
      "tracking",
      "Use Serialised or Quantity",
      errors,
    );
    const category = f.category
      ? await db.equipmentCategory.findFirst({
          where: { name: { equals: f.category, mode: "insensitive" }, status: "ACTIVE" },
          select: { id: true },
        })
      : null;
    if (f.category && !category) errors.category = [`No active category called “${f.category}”`];
    const raw = {
      sku: f.sku!,
      name: f.name!,
      categoryId: category?.id ?? "",
      tracking,
      manufacturer: blank(f.manufacturer!),
      model: blank(f.model!),
      currency: f.currency!,
      rentalDayRate: blank(f.rentalDayRate!),
      internalDayCost: blank(f.internalDayCost!),
      replacementValue: blank(f.replacementValue!),
      notes: blank(f.notes!),
    } as ItemInput;
    const { errors: problems } = await attempt(() => itemData(raw), { categoryId: "category" });
    // The category's own message is clearer than "Choose a category".
    if (problems && errors.category) delete problems.category;
    Object.assign(errors, problems);
    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      input: raw as Record<string, unknown>,
      keys: [`sku:${raw.sku.toUpperCase()}`],
    };
  },
  async match(_actor, input) {
    const sku = String((input as ItemInput).sku)
      .trim()
      .toUpperCase();
    const m = await db.equipmentItem.findUnique({
      where: { sku },
      select: { id: true, name: true },
    });
    // SKUs are unique, so a match can only be updated or skipped.
    return m ? { id: m.id, label: `${sku} ${m.name}`, reason: "Same SKU", canCreate: false } : null;
  },
  create: (actor, input) => createItem(actor, input as ItemInput),
  async update(actor, id, input) {
    const i = await db.equipmentItem.findUniqueOrThrow({ where: { id } });
    const money = (m: bigint | null) => (m === null ? null : minorToInput(m, i.currency));
    const existing: ItemInput = {
      sku: i.sku,
      name: i.name,
      categoryId: i.categoryId,
      tracking: i.tracking,
      manufacturer: i.manufacturer,
      model: i.model,
      description: i.description,
      currency: i.currency,
      rentalDayRate: money(i.rentalDayRateMinor),
      internalDayCost: money(i.internalDayCostMinor),
      replacementValue: money(i.replacementValueMinor),
      notes: i.notes,
    };
    return updateItem(actor, id, overlay(existing, input));
  },
};

export const ADAPTERS: Record<ImportKind, Adapter> = {
  CLIENTS: clients,
  VENDORS: vendors,
  CREW: crew,
  EQUIPMENT: equipment,
};
