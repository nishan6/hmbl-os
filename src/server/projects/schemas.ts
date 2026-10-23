import { z } from "zod";
import { codeSchema, currencySchema, optionalText, requiredText } from "@/lib/validation";
import { PROJECT_STATUSES, type ProjectStatus } from "./lifecycle";

export const REVENUE_MODELS = {
  FIXED_FEE: "Fixed fee",
  ITEMISED: "Itemised estimate",
  DAY_RATE: "Day rates",
  RENTAL: "Rental",
  RETAINER: "Retainer",
  COST_PLUS: "Cost plus",
  INTERNAL: "Internal (no revenue)",
} as const;
export type RevenueModel = keyof typeof REVENUE_MODELS;

const revenueModel = z.enum(Object.keys(REVENUE_MODELS) as [RevenueModel, ...RevenueModel[]], {
  message: "Choose how the project earns revenue",
});

export const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => v || null);

export const optionalDate = z
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

export const requiredDate = optionalDate.refine((d) => d !== null, "Enter a date");

export const projectTypeInput = z.object({
  code: codeSchema,
  name: requiredText(80),
  description: optionalText(500),
  defaultRevenueModel: revenueModel,
});
export type ProjectTypeInput = z.input<typeof projectTypeInput>;

/** The details a project manager keeps up to date. */
const detailFields = {
  name: requiredText(200),
  projectTypeId: optionalId,
  revenueModel,
  businessUnitId: optionalId,
  projectManagerId: optionalId,
  producerId: optionalId,
  clientPoNumber: optionalText(100),
  eventStartDate: optionalDate,
  eventEndDate: optionalDate,
  venue: optionalText(200),
  locations: optionalText(2000),
  description: optionalText(4000),
  scope: optionalText(8000),
  deliverables: optionalText(8000),
};

function datesInOrder<T extends { eventStartDate: Date | null; eventEndDate: Date | null }>(
  o: T,
  ctx: z.RefinementCtx,
) {
  if (o.eventStartDate && o.eventEndDate && o.eventEndDate < o.eventStartDate) {
    ctx.addIssue({
      code: "custom",
      path: ["eventEndDate"],
      message: "Ends before it starts",
    });
  }
}

export const projectDetailsInput = z.object(detailFields).superRefine(datesInOrder);
export type ProjectDetailsInput = z.input<typeof projectDetailsInput>;

/** A project created directly, without a quote: internal work, retainers. */
export const newProjectInput = z
  .object({
    ...detailFields,
    legalEntityId: z.uuid("Choose the HMBL entity"),
    clientId: optionalId,
    currency: currencySchema,
  })
  .superRefine(datesInOrder)
  .superRefine((o, ctx) => {
    if (!o.clientId && o.revenueModel !== "INTERNAL") {
      ctx.addIssue({
        code: "custom",
        path: ["clientId"],
        message: "Choose a client, or make it an internal project",
      });
    }
  });
export type NewProjectInput = z.input<typeof newProjectInput>;

export const statusMoveInput = z.object({
  to: z.enum(Object.keys(PROJECT_STATUSES) as [ProjectStatus, ...ProjectStatus[]], {
    message: "Choose a status",
  }),
  reason: optionalText(1000),
});
export type StatusMoveInput = z.input<typeof statusMoveInput>;
