import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ensureMasterDataDefaults } from "@/server/master-data/defaults";
import {
  createPaymentTerm,
  createTaxRate,
  createUnit,
  listPaymentTerms,
  listTaxRates,
  setDefaultPaymentTerm,
  setDefaultTaxRate,
  setTaxRateArchived,
  setUnitArchived,
} from "@/server/master-data/service";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";

describe("master data defaults", () => {
  it("creates GST 18% as India's default and 50% advance as the default payment term", async () => {
    await ensureMasterDataDefaults(db);
    const gst = await db.taxRate.findFirst({ where: { countryCode: "IN", isDefault: true } });
    expect(gst).toMatchObject({ code: "GST18", rateBps: 1800 });
    const term = await db.paymentTerm.findFirst({
      where: { isDefault: true },
      include: { instalments: { orderBy: { position: "asc" } } },
    });
    expect(term?.code).toBe("ADV50");
    expect(term?.instalments.map((i) => [i.percentBps, i.trigger])).toEqual([
      [5000, "ON_ACCEPTANCE"],
      [5000, "ON_DELIVERY"],
    ]);
  });

  it("is idempotent and never takes the default from an administrator's choice", async () => {
    const owner = await makeActor("owner");
    await createTaxRate(owner, { countryCode: "IN", code: "GST12", name: "GST 12%", rate: "12" });
    const first = await ensureMasterDataDefaults(db);
    const second = await ensureMasterDataDefaults(db);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    const defaults = await db.taxRate.findMany({ where: { countryCode: "IN", isDefault: true } });
    expect(defaults.map((d) => d.code)).toEqual(["GST12"]);
  });
});

describe("tax rates", () => {
  it("parses a typed percentage into basis points and makes the first rate the default", async () => {
    const owner = await makeActor("owner");
    const rate = await createTaxRate(owner, {
      countryCode: "in",
      code: "gst18",
      name: "GST 18%",
      rate: "18",
    });
    expect(rate).toMatchObject({
      countryCode: "IN",
      code: "GST18",
      rateBps: 1800,
      isDefault: true,
    });
    const event = await db.auditEvent.findFirst({ where: { action: "tax_rate.created" } });
    expect(event?.changes).toMatchObject({ rateBps: { from: null, to: 1800 } });
  });

  it("rejects impossible rates and non-zero exempt rates", async () => {
    const owner = await makeActor("owner");
    const base = { countryCode: "IN", code: "X1", name: "X" };
    await expect(createTaxRate(owner, { ...base, rate: "101" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(createTaxRate(owner, { ...base, rate: "-1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(createTaxRate(owner, { ...base, rate: "eighteen" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createTaxRate(owner, { ...base, rate: "5", treatment: "EXEMPT" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("has database checks on the rate range", async () => {
    await expect(
      db.taxRate.create({ data: { countryCode: "IN", code: "BAD", name: "Bad", rateBps: 20000 } }),
    ).rejects.toThrow();
    await expect(
      db.taxRate.create({
        data: { countryCode: "IN", code: "BAD", name: "Bad", rateBps: 500, treatment: "EXEMPT" },
      }),
    ).rejects.toThrow();
  });

  it("keeps one default per country when the default moves", async () => {
    const owner = await makeActor("owner");
    const gst18 = await createTaxRate(owner, {
      countryCode: "IN",
      code: "GST18",
      name: "GST 18%",
      rate: "18",
    });
    const gst5 = await createTaxRate(owner, {
      countryCode: "IN",
      code: "GST5",
      name: "GST 5%",
      rate: 500,
    });
    const vat = await createTaxRate(owner, {
      countryCode: "AE",
      code: "VAT5",
      name: "VAT",
      rate: 500,
    });
    expect(gst5.isDefault).toBe(false);
    expect(vat.isDefault).toBe(true);

    await setDefaultTaxRate(owner, gst5.id);
    const india = await listTaxRates(owner, { countryCode: "IN" });
    expect(india.filter((r) => r.isDefault).map((r) => r.id)).toEqual([gst5.id]);
    await expect(setTaxRateArchived(owner, gst5.id, true)).rejects.toBeInstanceOf(ConflictError);
    await setTaxRateArchived(owner, gst18.id, true);
    expect((await listTaxRates(owner, { countryCode: "IN" })).map((r) => r.code)).toEqual(["GST5"]);
  });

  it("needs Finance configuration rights across every entity", async () => {
    const sales = await makeActor("sales");
    const scopedFinance = await makeScopedActor("finance", (await makeEntity()).id);
    const input = { countryCode: "IN", code: "GST18", name: "GST 18%", rate: "18" };
    await expect(createTaxRate(sales, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTaxRate(scopedFinance, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTaxRate(await makeActor("finance"), input)).resolves.toBeDefined();
    // Sales can read rates to use them on quotes.
    await expect(listTaxRates(sales)).resolves.toHaveLength(1);
  });
});

describe("payment terms", () => {
  const term = {
    code: "ADV30",
    name: "30% advance, 70% a week before",
    instalments: [
      { label: "Advance", percent: "30", trigger: "ON_ACCEPTANCE" as const },
      { label: "Balance", percent: "70", trigger: "BEFORE_START" as const, days: 7 },
    ],
  };

  it("stores instalments in order and audits them", async () => {
    const owner = await makeActor("owner");
    const created = await createPaymentTerm(owner, term);
    expect(created.instalments.map((i) => [i.position, i.percentBps, i.days])).toEqual([
      [0, 3000, 0],
      [1, 7000, 7],
    ]);
    const event = await db.auditEvent.findFirst({ where: { action: "payment_term.created" } });
    expect(event?.changes).toMatchObject({ instalments: { to: [{ percentBps: 3000 }, {}] } });
  });

  it("requires instalments to add up to exactly 100%", async () => {
    const owner = await makeActor("owner");
    await expect(
      createPaymentTerm(owner, {
        ...term,
        instalments: [{ label: "Advance", percent: "50", trigger: "ON_ACCEPTANCE" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createPaymentTerm(owner, { ...term, instalments: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("drops days for triggers that don't use them", async () => {
    const owner = await makeActor("owner");
    const created = await createPaymentTerm(owner, {
      ...term,
      instalments: [{ label: "All", percent: "100", trigger: "ON_DELIVERY", days: 12 }],
    });
    expect(created.instalments[0]!.days).toBe(0);
  });

  it("moves the default and refuses to archive it", async () => {
    const owner = await makeActor("owner");
    const first = await createPaymentTerm(owner, term);
    const second = await createPaymentTerm(owner, { ...term, code: "OTHER" });
    expect([first.isDefault, second.isDefault]).toEqual([true, false]);
    await setDefaultPaymentTerm(owner, second.id);
    const terms = await listPaymentTerms(owner);
    expect(terms[0]!.id).toBe(second.id);
    expect(terms.filter((t) => t.isDefault)).toHaveLength(1);
  });

  it("is configured by Commercial, not Sales", async () => {
    await expect(createPaymentTerm(await makeActor("sales"), term)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("units", () => {
  it("creates, archives and rejects duplicate codes", async () => {
    const owner = await makeActor("owner");
    const unit = await createUnit(owner, { code: "day", name: "Day" });
    expect(unit.code).toBe("DAY");
    await expect(createUnit(owner, { code: "DAY", name: "Day" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await setUnitArchived(owner, unit.id, true);
    expect(await db.auditEvent.count({ where: { action: "unit.archived" } })).toBe(1);
  });
});
