import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createQuote, getQuote, saveDraft } from "@/server/commercial/quotes";
import { updateCommercialSettings } from "@/server/commercial/settings";
import {
  approveQuote,
  availableActions,
  baseValueMinor,
  issueQuote,
  listPendingApprovals,
  rejectQuote,
  reviseQuote,
  submitQuote,
  withdrawQuote,
} from "@/server/commercial/workflow";
import type { DraftInput } from "@/server/commercial/schemas";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeClient } from "../helpers/crm";
import { makeQuotingEntity, taxRate } from "../helpers/commercial";

async function setup(price = "100000") {
  const entity = await makeQuotingEntity();
  const client = await makeClient();
  const sales = await makeActor("sales");
  const director = await makeActor("owner");
  const quote = await createQuote(sales, {
    legalEntityId: entity.id,
    clientId: client.id,
    title: "Award night",
  });
  const draft = async (over: Partial<DraftInput> = {}) =>
    saveDraft(sales, quote.id, {
      title: "Award night",
      currency: "INR",
      validUntil: "2099-12-31",
      taxRateId: (await taxRate("GST18")).id,
      lines: [
        {
          category: "SERVICES",
          description: "Show",
          method: "FIXED",
          unitCost: "60000",
          unitPrice: price,
        },
      ],
      ...over,
    });
  await draft();
  return { entity, client, sales, director, quote, draft };
}

const latest = async (quoteId: string) =>
  db.quoteVersion.findFirstOrThrow({ where: { quoteId }, orderBy: { version: "desc" } });

describe("without approval (the default)", () => {
  it("lets sales issue a ready draft directly", async () => {
    const { sales, quote } = await setup();
    expect(await availableActions(sales, quote.id)).toMatchObject({
      needsApproval: false,
      submit: false,
      issue: true,
    });
    await expect(submitQuote(sales, quote.id)).rejects.toBeInstanceOf(ConflictError);
    await issueQuote(sales, quote.id);
    expect(await latest(quote.id)).toMatchObject({ status: "ISSUED", issuedById: sales.id });
    expect(await db.auditEvent.count({ where: { action: "quote.issued" } })).toBe(1);
  });

  it("refuses a quote that isn't ready", async () => {
    const { sales, quote, draft } = await setup();
    await draft({ lines: [] });
    await expect(issueQuote(sales, quote.id)).rejects.toThrow(/at least one line/);
    await draft({ currency: "AED" });
    await expect(issueQuote(sales, quote.id)).rejects.toThrow(/exchange rate to INR/);
    await draft({ validUntil: "2020-01-01" });
    const error = await issueQuote(sales, quote.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/validity date has passed/);
  });

  it("needs commercial.issue", async () => {
    const { quote } = await setup();
    const pm = await makeActor("project_manager");
    await expect(issueQuote(pm, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("with the Director's approval switched on", () => {
  it("submits, approves and then issues, keeping the trail", async () => {
    const { entity, sales, director, quote } = await setup();
    await updateCommercialSettings(director, entity.id, {
      requireQuoteApproval: true,
      quoteValidityDays: 30,
    });
    await expect(issueQuote(sales, quote.id)).rejects.toThrow(/needs the Director's approval/);
    await submitQuote(sales, quote.id, { comment: "Please check the LED price" });
    expect((await latest(quote.id)).status).toBe("PENDING_APPROVAL");
    expect((await listPendingApprovals(director)).map((v) => v.quoteId)).toEqual([quote.id]);
    expect(await listPendingApprovals(sales)).toEqual([]);

    await expect(approveQuote(sales, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
    await approveQuote(director, quote.id, { comment: "Fine" });
    await issueQuote(sales, quote.id);

    const steps = await db.quoteApprovalStep.findMany({ orderBy: { at: "asc" } });
    expect(steps.map((s) => [s.action, s.actorLabel, s.selfApproval])).toEqual([
      ["SUBMITTED", sales.name, false],
      ["APPROVED", director.name, false],
    ]);
    expect(steps[1]).toMatchObject({ totalMinor: 11800000n, marginBps: 4000 });
  });

  it("sends a rejected quote back to draft with the reason", async () => {
    const { entity, sales, director, quote, draft } = await setup();
    await updateCommercialSettings(director, entity.id, {
      requireQuoteApproval: true,
      quoteValidityDays: 30,
    });
    await submitQuote(sales, quote.id);
    await expect(
      saveDraft(sales, quote.id, {
        title: "X",
        currency: "INR",
        validUntil: "2099-01-01",
        lines: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(rejectQuote(director, quote.id, { comment: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await rejectQuote(director, quote.id, { comment: "Margin too thin on crew" });
    expect((await latest(quote.id)).status).toBe("DRAFT");
    await draft({ title: "Award night, revised crew" });
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "quote.rejected" } });
    expect(event.metadata).toMatchObject({ reason: "Margin too thin on crew" });
  });

  it("flags a Director approving their own quote", async () => {
    const { entity, director, quote } = await setup();
    await updateCommercialSettings(director, entity.id, {
      requireQuoteApproval: true,
      quoteValidityDays: 30,
    });
    await submitQuote(director, quote.id);
    await approveQuote(director, quote.id);
    const approved = await db.quoteApprovalStep.findFirstOrThrow({ where: { action: "APPROVED" } });
    expect(approved.selfApproval).toBe(true);
  });

  it("skips approval below the threshold, comparing in the entity's currency", async () => {
    const { entity, sales, director, quote, draft } = await setup("50000");
    await updateCommercialSettings(director, entity.id, {
      requireQuoteApproval: true,
      approvalThreshold: "1,00,000",
      quoteValidityDays: 30,
    });
    // ₹59,000 with tax: under ₹1,00,000.
    expect((await availableActions(sales, quote.id)).needsApproval).toBe(false);
    // AED 5,900 with tax, at 22.5 = ₹1,32,750: over.
    await draft({
      currency: "AED",
      fxRate: "22.5",
      lines: [{ category: "SERVICES", description: "Show", method: "FIXED", unitPrice: "5000" }],
    });
    expect((await availableActions(sales, quote.id)).needsApproval).toBe(true);
  });
});

describe("revisions and withdrawal", () => {
  it("revises an issued quote into a new draft and supersedes the old one", async () => {
    const { entity, sales, director, quote } = await setup();
    await updateCommercialSettings(director, entity.id, {
      requireQuoteApproval: false,
      quoteValidityDays: 14,
    });
    await issueQuote(sales, quote.id);
    await reviseQuote(sales, quote.id);
    const versions = await db.quoteVersion.findMany({
      where: { quoteId: quote.id },
      orderBy: { version: "asc" },
      include: { lines: true },
    });
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [1, "SUPERSEDED"],
      [2, "DRAFT"],
    ]);
    expect(versions[1]!.lines).toHaveLength(1);
    expect(versions[1]!.totalMinor).toBe(versions[0]!.totalMinor);
    const full = await getQuote(sales, quote.id);
    expect(full.version.version).toBe(2);
    expect(full.versions).toHaveLength(2);
    // The old version is untouched and still frozen.
    await expect(
      db.quoteLine.updateMany({ where: { versionId: versions[0]!.id }, data: { netMinor: 1n } }),
    ).rejects.toThrow(/can no longer be changed/);
    await expect(reviseQuote(sales, quote.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("withdraws with a reason", async () => {
    const { sales, quote } = await setup();
    await expect(withdrawQuote(sales, quote.id, { comment: "x" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await issueQuote(sales, quote.id);
    await withdrawQuote(sales, quote.id, { comment: "Client cancelled the event" });
    expect(await latest(quote.id)).toMatchObject({
      status: "WITHDRAWN",
      statusReason: "Client cancelled the event",
    });
  });
});

describe("settings", () => {
  it("need commercial.configure and are audited", async () => {
    const { entity, sales, director } = await setup();
    await expect(
      updateCommercialSettings(sales, entity.id, { quoteValidityDays: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateCommercialSettings(director, entity.id, { quoteValidityDays: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateCommercialSettings(director, entity.id, { quoteValidityDays: 45 });
    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "commercial_settings.updated" },
    });
    expect(event.changes).toEqual({ quoteValidityDays: { from: 30, to: 45 } });
  });
});

describe("base value", () => {
  it("converts with the rate and minor-unit difference", () => {
    expect(baseValueMinor(500000n, "AED", "INR", "22.5")).toBe(11250000n);
    expect(baseValueMinor(1000n, "JPY", "INR", "0.55")).toBe(55000n);
    expect(baseValueMinor(100n, "AED", "INR", null)).toBeNull();
    expect(baseValueMinor(100n, "INR", "INR", null)).toBe(100n);
  });
});
