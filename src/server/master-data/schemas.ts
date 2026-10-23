import { z } from "zod";
import { parsePercentToBps } from "@/lib/percent";
import { codeSchema, countryCodeSchema, optionalText, requiredText } from "@/lib/validation";

/** A percentage typed by a person ("18", "12.5") or given as basis points. */
export const percentBps = (options: { min?: number; max?: number } = {}) => {
  const { min = 0, max = 10000 } = options;
  return z
    .union([z.number().int(), z.string()])
    .transform((value, ctx) => {
      const bps = typeof value === "number" ? value : parsePercentToBps(value);
      if (bps === null) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage, e.g. 18 or 12.5" });
        return z.NEVER;
      }
      return bps;
    })
    .refine((bps) => bps >= min && bps <= max, {
      message: `Must be between ${min / 100}% and ${max / 100}%`,
    });
};

export const TAX_TREATMENTS = {
  STANDARD: "Standard rate",
  ZERO_RATED: "Zero-rated",
  EXEMPT: "Exempt",
  OUT_OF_SCOPE: "Out of scope",
} as const;

export const taxRateInput = z
  .object({
    countryCode: countryCodeSchema,
    code: codeSchema,
    name: requiredText(100),
    treatment: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]).default("STANDARD"),
    rate: percentBps(),
  })
  .refine((t) => t.treatment === "STANDARD" || t.rate === 0, {
    path: ["rate"],
    message: "Only a standard rate can be above 0%",
  });
export type TaxRateInput = z.input<typeof taxRateInput>;

export const PAYMENT_TRIGGERS = {
  ON_ACCEPTANCE: "On acceptance (advance)",
  BEFORE_START: "Days before the start",
  ON_DELIVERY: "On delivery",
  AFTER_DELIVERY: "Days after delivery",
} as const;

const instalmentInput = z
  .object({
    label: requiredText(100),
    percent: percentBps({ min: 1 }),
    trigger: z.enum(["ON_ACCEPTANCE", "BEFORE_START", "ON_DELIVERY", "AFTER_DELIVERY"]),
    days: z.coerce.number().int().min(0).max(365).default(0),
  })
  .transform((i) =>
    i.trigger === "BEFORE_START" || i.trigger === "AFTER_DELIVERY" ? i : { ...i, days: 0 },
  );

export const paymentTermInput = z.object({
  code: codeSchema,
  name: requiredText(100),
  description: optionalText(500),
  instalments: z
    .array(instalmentInput)
    .min(1, "Add at least one instalment")
    .max(12)
    .refine((list) => list.reduce((sum, i) => sum + i.percent, 0) === 10000, {
      message: "Instalments must add up to 100%",
    }),
});
export type PaymentTermInput = z.input<typeof paymentTermInput>;

export const unitInput = z.object({
  code: codeSchema,
  name: requiredText(60),
});
export type UnitInput = z.input<typeof unitInput>;
