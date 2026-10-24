import { z } from "zod";
import { ONE_OFF_CLIENT_CODE } from "@/lib/invoice-kinds";
import {
  countryCodeSchema,
  currencySchema,
  numberCodeSchema,
  optionalText,
  requiredText,
} from "@/lib/validation";

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.email("Enter a valid email address").nullable());

const optionalWebsite = optionalText(200).refine(
  (v) => v === null || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(v),
  "Enter a web address, e.g. example.com",
);

/** A checkbox: true, "on" or "true" mean yes; anything else, including absent, means no. */
const booleanish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

export const CLIENT_KINDS = { COMPANY: "Company", INDIVIDUAL: "Individual" } as const;
export const RELATIONSHIPS = { PROSPECT: "Prospect", CLIENT: "Client" } as const;

export const clientInput = z
  .object({
    name: requiredText(),
    legalName: optionalText(),
    kind: z.enum(["COMPANY", "INDIVIDUAL"]).default("COMPANY"),
    industry: optionalText(100),
    website: optionalWebsite,
    email: optionalEmail,
    phone: optionalText(40),
    taxIdType: optionalText(30).transform((v) => v?.toUpperCase() ?? null),
    taxId: optionalText(50).transform((v) => v?.toUpperCase().replace(/\s+/g, "") ?? null),
    addressLine1: optionalText(),
    addressLine2: optionalText(),
    city: optionalText(100),
    region: optionalText(100),
    postalCode: optionalText(20),
    countryCode: countryCodeSchema,
    currency: currencySchema,
    /** Short code in invoice numbers. Blank for one-off clients. */
    invoiceCode: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null)
      .pipe(
        numberCodeSchema
          .refine(
            (v) => v !== ONE_OFF_CLIENT_CODE,
            `${ONE_OFF_CLIENT_CODE} is the code one-off clients share`,
          )
          .nullable(),
      ),
    ownerId: z.uuid().nullish(),
    notes: optionalText(2000),
    /** Create even though similar clients exist. */
    allowDuplicate: booleanish,
  })
  .superRefine((c, ctx) => {
    if (c.taxId && !c.taxIdType) {
      ctx.addIssue({ code: "custom", path: ["taxIdType"], message: "Say what kind of tax ID" });
    }
    if (c.taxIdType === "GSTIN" && c.taxId && !GSTIN.test(c.taxId)) {
      ctx.addIssue({
        code: "custom",
        path: ["taxId"],
        message: "A GSTIN has 15 characters, e.g. 27AAAAA0000A1Z5",
      });
    }
  });
export type ClientInput = z.input<typeof clientInput>;

export const contactInput = z.object({
  name: requiredText(),
  jobTitle: optionalText(100),
  email: optionalEmail,
  phone: optionalText(40),
  isPrimary: booleanish,
  notes: optionalText(1000),
});
export type ContactInput = z.input<typeof contactInput>;

export const mergeInput = z.object({
  targetId: z.uuid("Choose the client to keep"),
  reason: requiredText(500),
});
