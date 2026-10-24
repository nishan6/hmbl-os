import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createClient, updateClient } from "@/server/crm/clients";
import { createCreditNote } from "@/server/finance/credit-notes";
import {
  createInvoiceService,
  listInvoiceServices,
  updateInvoiceService,
} from "@/server/finance/invoice-services";
import {
  createInvoice,
  getInvoice,
  issueInvoice,
  listInvoices,
  makeInvoiceFrom,
  saveInvoiceDraft,
} from "@/server/finance/invoices";
import { recordReceipt } from "@/server/finance/receipts";
import { receivablesAgeing } from "@/server/finance/receivables";
import {
  getNumberingScheme,
  replaceNumberingScheme,
  setNumberCounter,
} from "@/server/numbering/service";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import {
  day,
  issueSimpleInvoice,
  makeBankAccount,
  makeBillableClient,
  makeBooks,
} from "../helpers/finance";

/** HMBL's own format: 26-MAG-VLR-03-08 is MAG's 3rd invoice and the 8th overall in FY 2026-27. */
const HMBL_PATTERN = "{FYS}-{CLIENT}-{SERVICE}-{CSEQ:2}-{SEQ:2}";

async function setup() {
  const { entity, account } = await makeBooks();
  const owner = await makeActor("owner");
  const finance = await makeActor("finance");
  for (const [code, name] of [
    ["VLR", "Rental service"],
    ["LDS", "Live design services"],
  ]) {
    await createInvoiceService(finance, entity.id, { code: code!, name: name! });
  }
  const scheme = await db.numberingScheme.findFirstOrThrow({
    where: { legalEntityId: entity.id, documentType: "sales_invoice", status: "ACTIVE" },
  });
  const hmbl = await replaceNumberingScheme(owner, scheme.id, {
    pattern: HMBL_PATTERN,
    resetPolicy: "FISCAL_YEARLY",
    fiscalYearStartMonth: 4,
    startAt: 1,
  });
  const client = async (invoiceCode: string | null) => {
    const c = await makeBillableClient();
    return db.client.update({ where: { id: c.id }, data: { invoiceCode } });
  };
  return { entity, account, owner, finance, scheme: hmbl, client };
}

describe("HMBL invoice numbers", () => {
  it("counts per client and overall, and one-off clients share INT", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    const nwg = await client("NWG");
    const oneOff = await client(null);
    const another = await client(null);
    const issue = (clientId: string, serviceCode: string, invoiceDate = "2026-10-01") =>
      issueSimpleInvoice(finance, entity.id, clientId, { serviceCode, invoiceDate });

    expect((await issue(mag.id, "VLR")).number).toBe("26-MAG-VLR-01-01");
    expect((await issue(nwg.id, "LDS")).number).toBe("26-NWG-LDS-01-02");
    // The client's count runs across services.
    expect((await issue(mag.id, "LDS")).number).toBe("26-MAG-LDS-02-03");
    expect((await issue(oneOff.id, "VLR")).number).toBe("26-INT-VLR-01-04");
    expect((await issue(another.id, "LDS")).number).toBe("26-INT-LDS-02-05");
    // February 2027 is still FY 2026-27; April 2027 starts both counts again.
    expect((await issue(mag.id, "VLR", "2027-02-10")).number).toBe("26-MAG-VLR-03-06");
    expect((await issue(mag.id, "VLR", "2027-04-01")).number).toBe("27-MAG-VLR-01-01");
  });

  it("refuses to issue without the service the number needs", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    await expect(issueSimpleInvoice(finance, entity.id, mag.id)).rejects.toThrow(
      /Choose the service/,
    );
    // Nothing was used up: the next invoice is still the first.
    expect(
      (await issueSimpleInvoice(finance, entity.id, mag.id, { serviceCode: "VLR" })).number,
    ).toBe("26-MAG-VLR-01-01");
  });

  it("only takes an active service of the invoice's own entity", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    const vlr = (await listInvoiceServices(finance, entity.id)).find((v) => v.code === "VLR");
    await updateInvoiceService(finance, vlr!.id, { name: "Rental", archived: true });
    await expect(
      issueSimpleInvoice(finance, entity.id, mag.id, { serviceCode: "LDS" }),
    ).resolves.toMatchObject({ number: "26-MAG-LDS-01-01" });
    await expect(
      issueSimpleInvoice(finance, entity.id, mag.id, { serviceCode: "VLR" }),
    ).rejects.toThrow(ValidationError);
    const other = await makeBooks();
    await expect(
      issueSimpleInvoice(finance, other.entity.id, mag.id, { serviceCode: "LDS" }),
    ).rejects.toThrow(ValidationError);
  });

  it("hands out distinct consecutive numbers to invoices issued at once", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    const drafts = [];
    for (let i = 0; i < 8; i++) {
      const invoice = await createInvoice(finance, entity.id, { clientId: mag.id });
      await saveInvoiceDraft(finance, invoice.id, {
        invoiceDate: "2026-10-01",
        dueDate: "2026-10-31",
        currency: "INR",
        placeOfSupplyCountry: "IN",
        placeOfSupplyCode: "18",
        serviceCode: "VLR",
        lines: [
          {
            description: "Rental",
            quantity: "1",
            unitPrice: "1000",
            revenueAccountId: (await db.ledgerAccount.findUniqueOrThrow({
              where: {
                legalEntityId_systemKey: { legalEntityId: entity.id, systemKey: "REVENUE" },
              },
            }))!.id,
          },
        ],
      });
      drafts.push(invoice.id);
    }
    const issued = await Promise.all(drafts.map((id) => issueInvoice(finance, id)));
    const numbers = issued.map((i) => i.number!).sort();
    expect(numbers).toEqual(
      Array.from({ length: 8 }, (_, i) => {
        const n = String(i + 1).padStart(2, "0");
        return `26-MAG-VLR-${n}-${n}`;
      }),
    );
  });
});

describe("carrying on a series", () => {
  it("continues from the last overall and per-client numbers entered", async () => {
    const { entity, owner, finance, scheme, client } = await setup();
    const mag = await client("MAG");
    await setNumberCounter(owner, scheme.id, { date: "2026-10-01", lastValue: 18 });
    await setNumberCounter(owner, scheme.id, {
      date: "2026-10-01",
      clientCode: "mag",
      lastValue: 3,
    });
    expect(
      (await issueSimpleInvoice(finance, entity.id, mag.id, { serviceCode: "VLR" })).number,
    ).toBe("26-MAG-VLR-04-19");
    const view = await getNumberingScheme(owner, scheme.id);
    expect(view.counters.map((c) => [c.period, c.clientCode, c.lastValue])).toEqual([
      ["FY2026", "MAG", 4],
      ["FY2026", null, 19],
    ]);
    const audit = await db.auditEvent.findMany({
      where: { targetId: scheme.id, action: "numbering_counter.set" },
    });
    expect(audit).toHaveLength(2);
  });

  it("never moves a count back", async () => {
    const { owner, scheme } = await setup();
    await setNumberCounter(owner, scheme.id, { date: "2026-10-01", lastValue: 18 });
    await expect(
      setNumberCounter(owner, scheme.id, { date: "2026-10-01", lastValue: 10 }),
    ).rejects.toThrow(ConflictError);
    await expect(
      db.numberCounter.update({
        where: { schemeId_periodKey: { schemeId: scheme.id, periodKey: "FY2026" } },
        data: { lastValue: 5 },
      }),
    ).rejects.toThrow(/can't go back/);
    await expect(
      db.numberCounter.delete({
        where: { schemeId_periodKey: { schemeId: scheme.id, periodKey: "FY2026" } },
      }),
    ).rejects.toThrow(/can't be deleted/);
  });

  it("needs organisation.configure, and a per-client count in the format", async () => {
    const { entity, owner, finance, scheme } = await setup();
    await expect(
      setNumberCounter(finance, scheme.id, { date: "2026-10-01", lastValue: 5 }),
    ).rejects.toThrow(ForbiddenError);
    const plain = await replaceNumberingScheme(owner, scheme.id, {
      pattern: "INV/{FYY}/{SEQ:5}",
      resetPolicy: "FISCAL_YEARLY",
      fiscalYearStartMonth: 4,
      startAt: 1,
    });
    await expect(
      setNumberCounter(owner, plain.id, { date: "2026-10-01", clientCode: "MAG", lastValue: 2 }),
    ).rejects.toThrow(ValidationError);
    // The replaced format is archived; the entity still has exactly one active one.
    expect(
      await db.numberingScheme.count({
        where: { legalEntityId: entity.id, documentType: "sales_invoice", status: "ACTIVE" },
      }),
    ).toBe(1);
  });

  it("only lets invoices use {CLIENT}, {SERVICE} and {CSEQ}", async () => {
    const { entity, owner } = await setup();
    const receipts = await db.numberingScheme.findFirstOrThrow({
      where: { legalEntityId: entity.id, documentType: "receipt", status: "ACTIVE" },
    });
    await expect(
      replaceNumberingScheme(owner, receipts.id, {
        pattern: "RCT-{CLIENT}-{SEQ:4}",
        resetPolicy: "NEVER",
        fiscalYearStartMonth: 4,
        startAt: 1,
      }),
    ).rejects.toThrow(/no \{CLIENT\}/);
  });
});

describe("proforma and commercial invoices", () => {
  it("share the count with tax invoices but post nothing", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    const proforma = await issueSimpleInvoice(finance, entity.id, mag.id, {
      kind: "PROFORMA",
      serviceCode: "VLR",
    });
    expect(proforma).toMatchObject({
      kind: "PROFORMA",
      status: "ISSUED",
      number: "26-MAG-VLR-01-01",
      journalId: null,
    });
    const commercial = await makeInvoiceFrom(finance, proforma.id, { kind: "COMMERCIAL" });
    expect(commercial).toMatchObject({
      kind: "COMMERCIAL",
      status: "DRAFT",
      sourceInvoiceId: proforma.id,
      serviceCode: "VLR",
      totalMinor: proforma.totalMinor,
    });
    const issuedCommercial = await issueInvoice(finance, commercial.id);
    expect(issuedCommercial).toMatchObject({ number: "26-MAG-VLR-02-02", journalId: null });

    const tax = await makeInvoiceFrom(finance, commercial.id, { kind: "TAX" });
    const issuedTax = await issueInvoice(finance, tax.id);
    expect(issuedTax.number).toBe("26-MAG-VLR-03-03");
    expect(issuedTax.journalId).not.toBeNull();

    // Only the tax invoice is owed.
    const ageing = await receivablesAgeing(finance, entity.id, day("2026-12-31"));
    expect(ageing.invoices.map((i) => i.number)).toEqual(["26-MAG-VLR-03-03"]);
    const listed = await listInvoices(finance, { legalEntityId: entity.id });
    expect(Object.fromEntries(listed.map((i) => [i.kind, i.outstandingMinor]))).toEqual({
      PROFORMA: 0n,
      COMMERCIAL: 0n,
      TAX: issuedTax.totalMinor,
    });
    const view = await getInvoice(finance, commercial.id);
    expect(view.actions).toMatchObject({ receive: false, credit: false, makeFrom: [] });
    expect(view.madeFrom.map((m) => m.kind)).toEqual(["TAX"]);
    expect((await getInvoice(finance, proforma.id)).actions.makeFrom).toEqual(["TAX"]);
  });

  it("makes each later kind once, only from an issued earlier kind", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    const commercial = await issueSimpleInvoice(finance, entity.id, mag.id, {
      kind: "COMMERCIAL",
      serviceCode: "LDS",
    });
    const tax = await makeInvoiceFrom(finance, commercial.id, { kind: "TAX" });
    await expect(makeInvoiceFrom(finance, commercial.id, { kind: "TAX" })).rejects.toThrow(
      ConflictError,
    );
    await expect(makeInvoiceFrom(finance, commercial.id, { kind: "COMMERCIAL" })).rejects.toThrow(
      ConflictError,
    );
    await expect(makeInvoiceFrom(finance, tax.id, { kind: "TAX" })).rejects.toThrow(ConflictError);
  });

  it("can't take receipts or credit notes", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    const commercial = await issueSimpleInvoice(finance, entity.id, mag.id, {
      kind: "COMMERCIAL",
      serviceCode: "VLR",
    });
    const bank = await makeBankAccount(entity.id);
    await expect(
      recordReceipt(finance, entity.id, {
        clientId: mag.id,
        depositAccountId: bank.ledgerAccountId,
        date: "2026-10-05",
        method: "BANK_TRANSFER",
        reference: "UTR9",
        currency: "INR",
        amount: "118000",
        allocations: [{ invoiceId: commercial.id, amount: "118000" }],
      }),
    ).rejects.toThrow(ValidationError);
    // Taken as an advance instead, ready for the tax invoice.
    await expect(
      recordReceipt(finance, entity.id, {
        clientId: mag.id,
        depositAccountId: bank.ledgerAccountId,
        date: "2026-10-05",
        method: "BANK_TRANSFER",
        reference: "UTR9",
        currency: "INR",
        amount: "118000",
        allocations: [],
      }),
    ).resolves.toMatchObject({ amountMinor: 118_000_00n, status: "POSTED" });
    await expect(
      createCreditNote(finance, commercial.id, { date: "2026-10-05", reason: "x", lines: [] }),
    ).rejects.toThrow(/tax invoices/);
  });

  it("is guarded by the database too", async () => {
    const { entity, finance, client } = await setup();
    const mag = await client("MAG");
    const proforma = await issueSimpleInvoice(finance, entity.id, mag.id, {
      kind: "PROFORMA",
      serviceCode: "VLR",
    });
    const tax = await issueSimpleInvoice(finance, entity.id, mag.id, { serviceCode: "VLR" });
    await expect(
      db.salesInvoice.update({ where: { id: proforma.id }, data: { kind: "TAX" } }),
    ).rejects.toThrow(/can't be changed/);
    // A tax invoice can't be issued without its journal, nor an earlier kind with one.
    const draft = await createInvoice(finance, entity.id, { clientId: mag.id, kind: "COMMERCIAL" });
    await expect(
      db.salesInvoice.update({
        where: { id: draft.id },
        data: {
          status: "ISSUED",
          number: "X-1",
          issuedAt: new Date(),
          journalId: tax.journalId,
        },
      }),
    ).rejects.toThrow(/check/i);
    await expect(
      db.$executeRaw`INSERT INTO credit_notes (id, "legalEntityId", "invoiceId", date, reason, "createdById", "updatedAt")
        VALUES (gen_random_uuid(), ${entity.id}::uuid, ${proforma.id}::uuid, '2026-10-05', 'x', ${finance.id}::uuid, now())`,
    ).rejects.toThrow(/tax invoice/);
  });
});

describe("client invoice codes", () => {
  it("are unique among active clients, and INT is reserved", async () => {
    const sales = await makeActor("sales");
    const base = { countryCode: "IN", currency: "INR", allowDuplicate: true };
    const tse = await createClient(sales, {
      ...base,
      name: "Tesseract Esports",
      invoiceCode: "tse",
    });
    expect(tse.invoiceCode).toBe("TSE");
    await expect(
      createClient(sales, { ...base, name: "Other Esports", invoiceCode: "TSE" }),
    ).rejects.toMatchObject({
      fieldErrors: { invoiceCode: ["Tesseract Esports already uses TSE"] },
    });
    await expect(
      createClient(sales, { ...base, name: "Internal", invoiceCode: "INT" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      updateClient(sales, tse.id, { ...base, name: "Tesseract Esports", invoiceCode: "T-SE" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      db.client.update({ where: { id: tse.id }, data: { invoiceCode: "INT" } }),
    ).rejects.toThrow(/check/i);
  });
});

describe("invoice services", () => {
  it("keep their code and need finance.configure", async () => {
    const { entity, finance } = await setup();
    const sales = await makeActor("sales");
    await expect(
      createInvoiceService(sales, entity.id, { code: "XYZ", name: "Other" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createInvoiceService(finance, entity.id, { code: "VLR", name: "Again" }),
    ).rejects.toThrow(ConflictError);
    const [lds] = await listInvoiceServices(finance, entity.id);
    await expect(
      db.invoiceService.update({ where: { id: lds!.id }, data: { code: "LDX" } }),
    ).rejects.toThrow(/can't change/);
  });
});
