import { z } from "zod";
import {
  codeSchema,
  countryCodeSchema,
  currencySchema,
  optionalText,
  requiredText,
  timeZoneSchema,
} from "@/lib/validation";

const address = {
  addressLine1: optionalText(),
  addressLine2: optionalText(),
  city: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(20),
};

export const legalEntityInput = z.object({
  code: codeSchema,
  legalName: requiredText(),
  tradingName: optionalText(),
  countryCode: countryCodeSchema,
  baseCurrency: currencySchema,
  timezone: timeZoneSchema,
  ...address,
});
export type LegalEntityInput = z.input<typeof legalEntityInput>;

export const taxRegistrationInput = z.object({
  type: z.string().trim().toUpperCase().min(2).max(30),
  value: z.string().trim().toUpperCase().min(1).max(50),
  region: optionalText(100),
  validFrom: z.coerce.date().nullish(),
  validTo: z.coerce.date().nullish(),
});
export type TaxRegistrationInput = z.input<typeof taxRegistrationInput>;

export const businessUnitInput = z.object({
  code: codeSchema,
  name: requiredText(),
  description: optionalText(500),
});
export type BusinessUnitInput = z.input<typeof businessUnitInput>;

export const departmentInput = z.object({
  code: codeSchema,
  name: requiredText(),
  parentId: z.uuid().nullish(),
});
export type DepartmentInput = z.input<typeof departmentInput>;

export const costCentreInput = z.object({
  legalEntityId: z.uuid(),
  code: codeSchema,
  name: requiredText(),
  businessUnitId: z.uuid().nullish(),
  departmentId: z.uuid().nullish(),
});
export type CostCentreInput = z.input<typeof costCentreInput>;

export const locationInput = z.object({
  code: codeSchema,
  name: requiredText(),
  type: z.enum(["OFFICE", "WAREHOUSE", "STUDIO", "VENUE", "OTHER"]),
  legalEntityId: z.uuid().nullish(),
  countryCode: countryCodeSchema,
  timezone: timeZoneSchema,
  ...address,
});
export type LocationInput = z.input<typeof locationInput>;
