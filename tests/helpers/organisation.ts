import { db } from "@/server/db";

let counter = 0;

export async function makeEntity(
  overrides: { code?: string; status?: "ACTIVE" | "ARCHIVED" } = {},
) {
  counter += 1;
  return db.legalEntity.create({
    data: {
      code: overrides.code ?? `ENT-${counter}`,
      legalName: `Test Entity ${counter} Pvt Ltd`,
      countryCode: "IN",
      baseCurrency: "INR",
      timezone: "Asia/Kolkata",
      status: overrides.status ?? "ACTIVE",
    },
  });
}
