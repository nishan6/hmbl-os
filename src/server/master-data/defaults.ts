import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";

/*
 * DEFAULT MASTER DATA — labelled starting points, not approved policy
 * (docs/decisions.md). Created once if missing by `pnpm db:seed` and
 * `pnpm user:create`; after that, administrators add and archive their own.
 *
 * GST 18% is what HMBL usually charges (Nishan, 2026-10-23). Final rates per
 * service need sign-off from HMBL's tax adviser.
 */

export const DEFAULT_TAX_RATES = [
  { countryCode: "IN", code: "GST18", name: "GST 18%", rateBps: 1800, isDefault: true },
  { countryCode: "IN", code: "GST5", name: "GST 5%", rateBps: 500 },
  {
    countryCode: "IN",
    code: "GST0",
    name: "Zero-rated (export or SEZ)",
    rateBps: 0,
    treatment: "ZERO_RATED",
  },
  { countryCode: "IN", code: "EXEMPT", name: "Exempt", rateBps: 0, treatment: "EXEMPT" },
  { countryCode: "AE", code: "VAT5", name: "VAT 5%", rateBps: 500, isDefault: true },
  { countryCode: "AE", code: "VAT0", name: "Zero-rated", rateBps: 0, treatment: "ZERO_RATED" },
] as const;

/** 50% advance with the balance on delivery is HMBL's usual pattern (Nishan, 2026-10-23). */
export const DEFAULT_PAYMENT_TERMS = [
  {
    code: "ADV50",
    name: "50% advance, balance on delivery",
    isDefault: true,
    instalments: [
      { label: "Advance", percentBps: 5000, trigger: "ON_ACCEPTANCE", days: 0 },
      { label: "Balance", percentBps: 5000, trigger: "ON_DELIVERY", days: 0 },
    ],
  },
  {
    code: "ADV100",
    name: "100% in advance",
    instalments: [{ label: "Full payment", percentBps: 10000, trigger: "ON_ACCEPTANCE", days: 0 }],
  },
  {
    code: "NET30",
    name: "Full payment 30 days after delivery",
    instalments: [
      { label: "Full payment", percentBps: 10000, trigger: "AFTER_DELIVERY", days: 30 },
    ],
  },
] as const;

export const DEFAULT_UNITS = [
  ["EA", "Each"],
  ["DAY", "Day"],
  ["HR", "Hour"],
  ["SHOW", "Show"],
  ["SET", "Set"],
  ["LOT", "Lot"],
  ["WEEK", "Week"],
  ["MONTH", "Month"],
  ["KM", "Kilometre"],
  ["SQM", "Square metre"],
] as const;

/** Creates any default tax rate, payment term or unit that doesn't exist yet. */
export async function ensureMasterDataDefaults(db: PrismaClient): Promise<string[]> {
  const created: string[] = [];
  for (const rate of DEFAULT_TAX_RATES) {
    const where = { countryCode_code: { countryCode: rate.countryCode, code: rate.code } };
    if (await db.taxRate.findUnique({ where })) continue;
    // Never steal the default from a rate an administrator chose.
    const hasDefault =
      "isDefault" in rate &&
      (await db.taxRate.findFirst({
        where: { countryCode: rate.countryCode, isDefault: true, status: "ACTIVE" },
      }));
    await db.taxRate.create({ data: { ...rate, isDefault: "isDefault" in rate && !hasDefault } });
    created.push(`tax rate ${rate.countryCode} ${rate.code}`);
  }
  for (const term of DEFAULT_PAYMENT_TERMS) {
    if (await db.paymentTerm.findUnique({ where: { code: term.code } })) continue;
    const hasDefault =
      "isDefault" in term &&
      (await db.paymentTerm.findFirst({ where: { isDefault: true, status: "ACTIVE" } }));
    await db.paymentTerm.create({
      data: {
        code: term.code,
        name: term.name,
        isDefault: "isDefault" in term && !hasDefault,
        instalments: {
          create: term.instalments.map((i, position) => ({ ...i, position })),
        },
      },
    });
    created.push(`payment term ${term.code}`);
  }
  for (const [code, name] of DEFAULT_UNITS) {
    if (await db.unit.findUnique({ where: { code } })) continue;
    await db.unit.create({ data: { code, name } });
    created.push(`unit ${code}`);
  }
  return created;
}
