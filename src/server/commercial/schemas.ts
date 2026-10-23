import { z } from "zod";
import { parseMoneyToMinor } from "@/lib/money";
import { parseQuantity, MILLI, type PricingMethod } from "@/lib/pricing";
import { currencySchema, optionalText, requiredText } from "@/lib/validation";
import { percentBps } from "@/server/master-data/schemas";

export const LINE_CATEGORIES = {
  CREW: "Crew",
  EQUIPMENT: "Equipment",
  RENTAL: "Rental",
  SERVICES: "Services",
  PRODUCTION: "Production",
  TRAVEL: "Travel",
  LOGISTICS: "Logistics",
  FEES: "Fees",
  OTHER: "Other",
} as const;
export type LineCategory = keyof typeof LINE_CATEGORIES;

const blankToNull = (v: unknown) => (v === "" ? null : v);

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => v || null);

const optionalDate = z
  .union([z.date(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const date = v instanceof Date ? v : new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a date" });
      return z.NEVER;
    }
    return date;
  });

const optionalPercent = (options?: { min?: number; max?: number }) =>
  z
    .preprocess(blankToNull, percentBps(options).nullish())
    .optional()
    .transform((v) => v ?? null);

/** An amount typed in the quote's currency, or minor units as a bigint. */
const amount = z.union([z.bigint(), z.string()]).nullish();

/** A quantity typed by a person ("2.5"), or thousandths as a bigint. */
const quantity = z
  .union([z.bigint(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (typeof v === "bigint") return v;
    if (v === null || v === undefined || v.trim() === "") return MILLI;
    const parsed = parseQuantity(v);
    if (parsed === null || parsed <= 0n) {
      ctx.addIssue({ code: "custom", message: "Enter a number above zero, e.g. 2 or 2.5" });
      return z.NEVER;
    }
    return parsed;
  });

export const createQuoteInput = z.object({
  legalEntityId: z.uuid("Choose the HMBL entity"),
  clientId: z.uuid("Choose a client"),
  opportunityId: optionalId,
  contactId: optionalId,
  title: requiredText(),
});
export type CreateQuoteInput = z.input<typeof createQuoteInput>;

const lineInput = z.object({
  section: optionalText(100),
  category: z.enum(Object.keys(LINE_CATEGORIES) as [LineCategory, ...LineCategory[]]),
  description: requiredText(500),
  method: z.enum(["UNIT_RATE", "FIXED", "COST_PLUS_MARKUP", "COST_PLUS_MARGIN"]),
  quantity,
  days: quantity,
  unitId: optionalId,
  unitCost: amount,
  unitPrice: amount,
  markup: optionalPercent({ max: 100000 }),
  margin: optionalPercent({ max: 9999 }),
  discount: optionalPercent(),
  taxRateId: optionalId,
});

export const MAX_LINES = 300;

export const draftInput = z
  .object({
    /** The version's updatedAt when the editor loaded it, to catch overlapping edits. */
    expectedUpdatedAt: z.string().optional(),
    title: requiredText(),
    contactId: optionalId,
    currency: currencySchema,
    fxRate: z.string().trim().nullish(),
    fxNote: optionalText(200),
    validUntil: optionalDate,
    paymentTermId: optionalId,
    taxRateId: optionalId,
    contingency: optionalPercent(),
    poRequired: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => v === true || v === "on" || v === "true"),
    eventStartDate: optionalDate,
    eventEndDate: optionalDate,
    venue: optionalText(200),
    scope: optionalText(8000),
    deliverables: optionalText(8000),
    exclusions: optionalText(8000),
    terms: optionalText(8000),
    internalNotes: optionalText(4000),
    lines: z.array(lineInput).max(MAX_LINES, `A quote can have at most ${MAX_LINES} lines`),
  })
  .transform((d, ctx) => {
    if (!d.validUntil) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Enter a validity date" });
      return z.NEVER;
    }
    if (d.eventStartDate && d.eventEndDate && d.eventEndDate < d.eventStartDate) {
      ctx.addIssue({
        code: "custom",
        path: ["eventEndDate"],
        message: "Must be on or after the start",
      });
      return z.NEVER;
    }
    let fxRateToBase: string | null = null;
    if (d.fxRate) {
      if (!/^\d{1,9}(\.\d{1,8})?$/.test(d.fxRate) || /^0+(\.0+)?$/.test(d.fxRate)) {
        ctx.addIssue({
          code: "custom",
          path: ["fxRate"],
          message: "Enter a rate above zero, up to 8 decimals",
        });
        return z.NEVER;
      }
      fxRateToBase = d.fxRate;
    }
    const money = (value: bigint | string | null | undefined, path: (string | number)[]) => {
      if (typeof value === "bigint") return value;
      if (!value?.trim()) return 0n;
      const minor = parseMoneyToMinor(value, d.currency);
      if (minor === null || minor < 0n) {
        ctx.addIssue({ code: "custom", path, message: "Enter an amount, e.g. 25000" });
        return 0n;
      }
      return minor;
    };
    const lines = d.lines.map((l, i) => ({
      section: l.section,
      category: l.category,
      description: l.description,
      method: l.method as PricingMethod,
      quantityMilli: l.method === "FIXED" ? MILLI : l.quantity,
      daysMilli: l.method === "FIXED" ? MILLI : l.days,
      unitId: l.unitId,
      unitCostMinor: money(l.unitCost, ["lines", i, "unitCost"]),
      unitPriceMinor: l.method.startsWith("COST_PLUS")
        ? 0n
        : money(l.unitPrice, ["lines", i, "unitPrice"]),
      markupBps: l.method === "COST_PLUS_MARKUP" ? l.markup : null,
      marginBps: l.method === "COST_PLUS_MARGIN" ? l.margin : null,
      discountBps: l.discount ?? 0,
      taxRateId: l.taxRateId,
    }));
    const { fxRate: _fx, contingency, lines: _lines, ...rest } = d;
    void _fx;
    void _lines;
    return {
      ...rest,
      validUntil: d.validUntil,
      fxRateToBase,
      contingencyBps: contingency ?? 0,
      lines,
    };
  });
export type DraftInput = z.input<typeof draftInput>;
export type DraftLineInput = z.input<typeof lineInput>;
