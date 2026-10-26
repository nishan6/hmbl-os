/*
 * What each kind of import reads (docs/imports.md): the fields, the column
 * names they are usually found under, and how a file's columns are mapped to
 * them. Pure functions, shared by the server and the mapping screen.
 */

export type ImportKind = "CLIENTS" | "VENDORS" | "CREW" | "EQUIPMENT";

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  /** Lower-case header names this field is often found under. */
  aliases?: string[];
  hint?: string;
};

const address: ImportField[] = [
  { key: "addressLine1", label: "Address line 1", aliases: ["address", "address 1", "street"] },
  { key: "addressLine2", label: "Address line 2", aliases: ["address 2"] },
  { key: "city", label: "City", aliases: ["town"] },
  { key: "region", label: "State or region", aliases: ["state", "province", "region"] },
  {
    key: "postalCode",
    label: "Postal code",
    aliases: ["pin", "pincode", "pin code", "zip", "postcode"],
  },
  {
    key: "countryCode",
    label: "Country",
    required: true,
    aliases: ["country", "country code"],
    hint: "Two-letter code, e.g. IN",
  },
];

export const IMPORT_KINDS: Record<
  ImportKind,
  { label: string; singular: string; fields: ImportField[] }
> = {
  CLIENTS: {
    label: "Clients",
    singular: "client",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["client", "client name", "company"] },
      { key: "legalName", label: "Legal name", aliases: ["registered name"] },
      {
        key: "kind",
        label: "Company or individual",
        aliases: ["type"],
        hint: "Company or Individual",
      },
      { key: "industry", label: "Industry", aliases: ["sector"] },
      { key: "website", label: "Website", aliases: ["web", "url"] },
      { key: "email", label: "Email", aliases: ["e-mail", "email address"] },
      { key: "phone", label: "Phone", aliases: ["telephone", "mobile", "phone number"] },
      { key: "taxIdType", label: "Tax ID type", aliases: ["tax type"], hint: "e.g. GSTIN" },
      { key: "taxId", label: "Tax ID", aliases: ["gstin", "gst", "gst number", "vat", "trn"] },
      ...address,
      {
        key: "currency",
        label: "Currency",
        required: true,
        aliases: ["currency code"],
        hint: "Three-letter code, e.g. INR",
      },
      { key: "invoiceCode", label: "Invoice code", aliases: ["client code", "code"] },
      { key: "notes", label: "Notes", aliases: ["remarks", "comments"] },
    ],
  },
  VENDORS: {
    label: "Vendors",
    singular: "vendor",
    fields: [
      {
        key: "name",
        label: "Name",
        required: true,
        aliases: ["vendor", "vendor name", "supplier"],
      },
      { key: "legalName", label: "Legal name", aliases: ["registered name"] },
      {
        key: "kind",
        label: "Company or individual",
        aliases: ["type"],
        hint: "Company or Individual",
      },
      { key: "email", label: "Email", aliases: ["e-mail", "email address"] },
      { key: "phone", label: "Phone", aliases: ["telephone", "mobile", "phone number"] },
      { key: "gstin", label: "GSTIN", aliases: ["gst", "gst number"] },
      { key: "pan", label: "PAN", aliases: ["pan number"] },
      { key: "msmeNumber", label: "MSME (Udyam) number", aliases: ["msme", "udyam"] },
      ...address,
      { key: "currency", label: "Currency", required: true, aliases: ["currency code"] },
      {
        key: "paymentTermsDays",
        label: "Payment terms (days)",
        aliases: ["payment terms", "credit days", "terms"],
        hint: "Blank means 30",
      },
      { key: "tdsSection", label: "TDS section", aliases: ["tds"], hint: "Finance only" },
      { key: "tdsRate", label: "TDS rate %", aliases: ["tds rate", "tds %"], hint: "Finance only" },
      { key: "notes", label: "Notes", aliases: ["remarks", "comments"] },
    ],
  },
  CREW: {
    label: "Crew",
    singular: "crew member",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["full name", "crew", "crew name"] },
      {
        key: "kind",
        label: "Staff or freelancer",
        required: true,
        aliases: ["type", "employment"],
        hint: "Staff (or Employee) or Freelancer",
      },
      { key: "email", label: "Email", aliases: ["e-mail", "email address"] },
      { key: "phone", label: "Phone", aliases: ["mobile", "phone number", "telephone"] },
      { key: "baseCity", label: "Based in", aliases: ["city", "base", "location"] },
      { key: "preferredLocations", label: "Other locations", aliases: ["locations"] },
      {
        key: "skills",
        label: "Skills",
        aliases: ["roles", "role", "skill"],
        hint: "Separated by commas",
      },
      { key: "contractRef", label: "Contract reference", aliases: ["contract", "nda"] },
      { key: "notes", label: "Notes", aliases: ["remarks", "comments"] },
    ],
  },
  EQUIPMENT: {
    label: "Equipment items",
    singular: "equipment item",
    fields: [
      { key: "sku", label: "SKU", required: true, aliases: ["code", "item code", "part number"] },
      { key: "name", label: "Name", required: true, aliases: ["item", "item name", "description"] },
      {
        key: "category",
        label: "Category",
        required: true,
        aliases: ["category name", "group"],
        hint: "An existing category's name",
      },
      {
        key: "tracking",
        label: "Tracking",
        required: true,
        aliases: ["tracked by"],
        hint: "Serialised or Quantity",
      },
      { key: "manufacturer", label: "Manufacturer", aliases: ["make", "brand"] },
      { key: "model", label: "Model" },
      { key: "currency", label: "Currency", required: true, aliases: ["currency code"] },
      { key: "rentalDayRate", label: "Rental day rate", aliases: ["day rate", "rental rate"] },
      { key: "internalDayCost", label: "Internal day cost", aliases: ["internal cost"] },
      {
        key: "replacementValue",
        label: "Replacement value",
        aliases: ["replacement cost", "value"],
      },
      { key: "notes", label: "Notes", aliases: ["remarks", "comments"] },
    ],
  },
};

/** A field's source: a column of the file, or one value for every row. */
export type FieldSource = number | { value: string };
export type ImportMapping = Record<string, FieldSource>;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Matches headers to fields by label, key or a usual alias. Each column is used once. */
export function guessMapping(kind: ImportKind, headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<number>();
  const names = headers.map(norm);
  for (const field of IMPORT_KINDS[kind].fields) {
    const wanted = [field.label, field.key, ...(field.aliases ?? [])].map(norm);
    const index = names.findIndex((h, i) => !used.has(i) && wanted.includes(h));
    if (index >= 0) {
      mapping[field.key] = index;
      used.add(index);
    }
  }
  return mapping;
}

/** Keeps only known fields and columns that exist. */
export function cleanMapping(kind: ImportKind, raw: unknown, columns: number): ImportMapping {
  const mapping: ImportMapping = {};
  if (!raw || typeof raw !== "object") return mapping;
  const keys = new Set(IMPORT_KINDS[kind].fields.map((f) => f.key));
  for (const [key, source] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.has(key)) continue;
    if (typeof source === "number" && Number.isInteger(source) && source >= 0 && source < columns) {
      mapping[key] = source;
    } else if (
      source &&
      typeof source === "object" &&
      typeof (source as { value?: unknown }).value === "string" &&
      (source as { value: string }).value.trim()
    ) {
      mapping[key] = { value: (source as { value: string }).value.trim().slice(0, 200) };
    }
  }
  return mapping;
}

/** A row's text per field: corrections first, then the mapped column or fixed value. Blank is "". */
export function rowFields(
  kind: ImportKind,
  values: string[],
  mapping: ImportMapping,
  edits: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of IMPORT_KINDS[kind].fields) {
    const source = mapping[key];
    const mapped =
      source === undefined
        ? ""
        : typeof source === "number"
          ? (values[source] ?? "")
          : source.value;
    out[key] = (key in edits ? edits[key]! : mapped).trim();
  }
  return out;
}

/** Required fields with no source at all. */
export function unmappedRequired(kind: ImportKind, mapping: ImportMapping) {
  return IMPORT_KINDS[kind].fields.filter((f) => f.required && mapping[f.key] === undefined);
}

/** The most rows one file may hold, and its largest size. */
export const IMPORT_LIMITS = { rows: 5000, bytes: 2_000_000 };
