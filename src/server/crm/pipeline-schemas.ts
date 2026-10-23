import { z } from "zod";
import { parseMoneyToMinor } from "@/lib/money";
import { currencySchema, optionalText, requiredText } from "@/lib/validation";
import { percentBps } from "@/server/master-data/schemas";

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

/** Blank means "not set". */
const blankToNull = (v: unknown) => (v === "" ? null : v);

const optionalPercent = z
  .preprocess(blankToNull, percentBps().nullish())
  .optional()
  .transform((v) => v ?? null);

export const opportunityInput = z
  .object({
    legalEntityId: z.uuid("Choose the HMBL entity"),
    clientId: z.uuid("Choose a client"),
    contactId: z
      .union([z.uuid(), z.literal("")])
      .nullish()
      .transform((v) => v || null),
    title: requiredText(),
    description: optionalText(4000),
    stageId: z
      .union([z.uuid(), z.literal("")])
      .nullish()
      .transform((v) => v || null),
    ownerId: z
      .union([z.uuid(), z.literal("")])
      .nullish()
      .transform((v) => (v === "" ? null : v)),
    businessUnitId: z
      .union([z.uuid(), z.literal("")])
      .nullish()
      .transform((v) => v || null),
    source: optionalText(100),
    currency: currencySchema,
    expectedValue: z.union([z.bigint(), z.string()]).nullish(),
    probability: optionalPercent,
    expectedCloseDate: optionalDate,
    eventStartDate: optionalDate,
    eventEndDate: optionalDate,
    venue: optionalText(200),
    competitors: optionalText(1000),
  })
  .transform((o, ctx) => {
    let expectedValueMinor: bigint | null = null;
    if (typeof o.expectedValue === "bigint") expectedValueMinor = o.expectedValue;
    else if (o.expectedValue?.trim()) {
      expectedValueMinor = parseMoneyToMinor(o.expectedValue, o.currency);
      if (expectedValueMinor === null) {
        ctx.addIssue({
          code: "custom",
          path: ["expectedValue"],
          message: "Enter an amount, e.g. 1250000",
        });
        return z.NEVER;
      }
    }
    if (expectedValueMinor !== null && expectedValueMinor < 0n) {
      ctx.addIssue({ code: "custom", path: ["expectedValue"], message: "Can't be negative" });
      return z.NEVER;
    }
    if (o.eventStartDate && o.eventEndDate && o.eventEndDate < o.eventStartDate) {
      ctx.addIssue({
        code: "custom",
        path: ["eventEndDate"],
        message: "Must be on or after the start",
      });
      return z.NEVER;
    }
    const { expectedValue: _value, probability, ...rest } = o;
    void _value;
    return { ...rest, expectedValueMinor, probabilityBps: probability };
  });
export type OpportunityInput = z.input<typeof opportunityInput>;

export const moveInput = z.object({
  stageId: z.uuid("Choose a stage"),
  reason: optionalText(1000),
});

export const STAGE_KINDS = {
  OPEN: "Open",
  WON: "Won",
  LOST: "Lost",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
} as const;

export const stageInput = z.object({
  name: requiredText(60),
  kind: z.enum(["OPEN", "WON", "LOST", "ON_HOLD", "CANCELLED"]),
  probability: optionalPercent,
});
export type StageInput = z.input<typeof stageInput>;

export const ACTIVITY_TYPES = {
  NOTE: "Note",
  CALL: "Call",
  MEETING: "Meeting",
  EMAIL: "Email",
  FOLLOW_UP: "Follow-up",
} as const;

const dateTime = z.union([z.date(), z.string().min(1)]).transform((v, ctx) => {
  const date = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: "custom", message: "Enter a date and time" });
    return z.NEVER;
  }
  return date;
});

export const activityInput = z
  .object({
    type: z.enum(["NOTE", "CALL", "MEETING", "EMAIL", "FOLLOW_UP"]),
    subject: requiredText(),
    body: optionalText(4000),
    occurredAt: dateTime.optional(),
    dueAt: z
      .preprocess(blankToNull, dateTime.nullish())
      .optional()
      .transform((v) => v ?? null),
    ownerId: z
      .union([z.uuid(), z.literal("")])
      .nullish()
      .transform((v) => v || null),
  })
  .refine((a) => a.type !== "FOLLOW_UP" || a.dueAt, {
    path: ["dueAt"],
    message: "A follow-up needs a due date",
  });
export type ActivityInput = z.input<typeof activityInput>;
