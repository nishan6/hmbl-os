import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveBill, getBill, saveBillDraft, submitBill } from "@/server/finance/bills";
import { draftBillFromOrder } from "@/server/procurement/billing";
import {
  approveOrder,
  cancelOrder,
  closeOrder,
  createOrder,
  getOrder,
  recordReceipt,
  saveOrder,
  startAmendment,
  submitOrder,
  withdrawAmendment,
  type OrderLineInput,
} from "@/server/procurement/orders";
import { updateProcurementSettings } from "@/server/procurement/settings";
import { getProjectBudget } from "@/server/projects/budget";
import { getVendor, updateVendor } from "@/server/vendors/service";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { taxRate } from "../helpers/commercial";
import { giveBooks, makeVendor } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

/** The field messages a rejected call gave, joined, for matching. */
async function fieldMessages(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return Object.values((error as ValidationError).fieldErrors ?? {})
    .flat()
    .join(" ");
}

/**
 * The accepted project's stage build line (cost 60,000) takes the orders.
 * The vendor is in Assam, like the entity, so GST is CGST + SGST.
 */
async function setup() {
  const { entity, project } = await makeAcceptedProject();
  await giveBooks(entity.id);
  const owner = await makeActor("owner");
  const buyer = await makeActor("procurement");
  const finance = await makeActor("finance");
  const vendor = await makeVendor();
  const stage = await db.projectBudgetLine.findFirstOrThrow({
    where: { projectId: project.id, category: "PRODUCTION" },
  });
  const gst = await taxRate("GST18");
  const budget = async () => (await getProjectBudget(owner, project.id)).totals;
  const line = (patch: Partial<OrderLineInput> = {}): OrderLineInput => ({
    description: "Hazer",
    quantity: "2",
    unitPrice: "6500",
    taxRateId: gst.id,
    budgetLineId: stage.id,
    ...patch,
  });
  const order = async (kind: "RENTAL" | "SERVICES" | "CONSUMABLES", lines = [line()]) => {
    const po = await createOrder(buyer, entity.id, {
      vendorId: vendor.id,
      kind,
      projectId: project.id,
    });
    await saveOrder(buyer, po.id, {
      supplyType: po.supplyType,
      hireFrom: kind === "RENTAL" ? "2099-03-10" : null,
      hireTo: kind === "RENTAL" ? "2099-03-12" : null,
      lines,
    });
    return po;
  };
  const lines = (id: string) =>
    db.purchaseOrderLine.findMany({ where: { purchaseOrderId: id }, orderBy: { position: "asc" } });
  return { entity, project, owner, buyer, finance, vendor, stage, budget, line, order, lines };
}

describe("purchase orders", () => {
  it("is approved above the threshold, commits its cost, and bills what was received without counting it twice", async () => {
    const s = await setup();
    const po = await s.order("RENTAL");
    expect(po.currency).toBe("INR");
    // The default threshold is zero: every order waits for an approver.
    expect((await submitOrder(s.buyer, po.id)).status).toBe("SUBMITTED");
    await expect(approveOrder(s.buyer, po.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await s.budget()).committedMinor).toBe(0n);

    const approved = await approveOrder(s.finance, po.id);
    expect(approved.number).toMatch(/^PO\//);
    expect(approved.revision).toBe(1);
    expect((await s.budget()).committedMinor).toBe(13_000_00n);

    // Nothing received: a rental can't be billed yet.
    await expect(draftBillFromOrder(s.finance, po.id)).rejects.toBeInstanceOf(ConflictError);
    const [hazer] = await s.lines(po.id);
    await expect(
      recordReceipt(s.buyer, po.id, {
        receivedOn: "2026-10-01",
        quantities: { [hazer!.id]: "3" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await recordReceipt(s.buyer, po.id, {
      receivedOn: "2026-10-01",
      reference: "DN-1",
      quantities: { [hazer!.id]: "1" },
    });

    const bill = await draftBillFromOrder(s.finance, po.id);
    const drafted = await getBill(s.finance, bill.id);
    expect(drafted.lines).toHaveLength(1);
    expect(drafted.lines[0]).toMatchObject({
      purchaseOrderLineId: hazer!.id,
      commitmentId: hazer!.commitmentId,
      budgetLineId: s.stage.id,
      amountMinor: 6_500_00n,
    });
    expect(drafted.lines[0]!.quantity.toString()).toBe("1");

    // Billing more than arrived is refused when the draft is saved.
    const save = (quantity: string) =>
      saveBillDraft(s.finance, bill.id, {
        vendorInvoiceNumber: "INV-77",
        billDate: "2026-10-02",
        dueDate: "2026-11-01",
        currency: "INR",
        supplyType: drafted.supplyType,
        lines: drafted.lines.map((l) => ({
          description: l.description,
          quantity,
          unitPrice: "6500",
          taxRateId: l.taxRateId,
          accountId: l.accountId,
          projectId: l.projectId,
          budgetLineId: l.budgetLineId,
          commitmentId: l.commitmentId,
          purchaseOrderLineId: l.purchaseOrderLineId,
        })),
      });
    expect(await fieldMessages(save("2"))).toMatch(/Only 1 of this/);
    await save("1");
    await submitBill(s.finance, bill.id);
    await approveBill(s.finance, bill.id);
    // The bill's actual cost draws the commitment down: still 13,000 in all.
    const totals = await s.budget();
    expect(totals.actualMinor).toBe(6_500_00n);
    expect(totals.committedMinor).toBe(6_500_00n);

    // A rental can't be closed while some of it is still on hire.
    await expect(closeOrder(s.buyer, po.id, { reason: "Done" })).rejects.toThrow(/on hire/);
    expect(
      await fieldMessages(
        recordReceipt(s.buyer, po.id, {
          kind: "RETURNED",
          receivedOn: "2026-10-03",
          quantities: { [hazer!.id]: "2" },
        }),
      ),
    ).toMatch(/Only 1 is still on hire/);
    await recordReceipt(s.buyer, po.id, {
      kind: "RETURNED",
      receivedOn: "2026-10-03",
      quantities: { [hazer!.id]: "1" },
    });
    // Received and billed, so it can't be cancelled; closing releases the rest.
    await expect(cancelOrder(s.finance, po.id, { reason: "x" })).rejects.toThrow(/Close it/);
    await closeOrder(s.buyer, po.id, { reason: "Second hazer not needed" });
    const after = await s.budget();
    expect(after.actualMinor).toBe(6_500_00n);
    expect(after.committedMinor).toBe(0n);
    const view = await getOrder(s.owner, po.id);
    expect(view.order.status).toBe("CLOSED");
    expect(view.bills).toHaveLength(1);
  });

  it("approves within the threshold on submission and controls amendments", async () => {
    const s = await setup();
    await updateProcurementSettings(s.finance, s.entity.id, { approvalThreshold: "50000" });
    await expect(
      updateProcurementSettings(s.buyer, s.entity.id, { approvalThreshold: "1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const po = await s.order("SERVICES", [s.line({ description: "Stage crew", quantity: "4" })]);
    const approved = await submitOrder(s.buyer, po.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(s.buyer.id);
    expect((await s.budget()).committedMinor).toBe(26_000_00n);
    const [crew] = await s.lines(po.id);
    // Services are billed as ordered; nothing needs receiving first.
    await recordReceipt(s.buyer, po.id, {
      receivedOn: "2026-10-01",
      quantities: { [crew!.id]: "1" },
    });

    // A cheaper version applies straight away and the commitment follows it.
    await startAmendment(s.buyer, po.id, { reason: "Vendor discount" });
    await expect(
      recordReceipt(s.buyer, po.id, { receivedOn: "2026-10-01", quantities: { [crew!.id]: "1" } }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      await fieldMessages(
        saveOrder(s.buyer, po.id, {
          supplyType: po.supplyType,
          lines: [{ ...s.line({ quantity: "0.5", description: "Stage crew" }), id: crew!.id }],
        }),
      ),
    ).toMatch(/can't go lower/);
    await saveOrder(s.buyer, po.id, {
      supplyType: po.supplyType,
      lines: [{ ...s.line({ unitPrice: "6000", quantity: "4" }), id: crew!.id }],
    });
    const cheaper = await submitOrder(s.buyer, po.id);
    expect(cheaper).toMatchObject({ status: "APPROVED", revision: 2 });
    expect((await s.budget()).committedMinor).toBe(24_000_00n);

    // Raising it above the threshold needs approval, and withdrawing restores revision 2.
    await startAmendment(s.buyer, po.id, { reason: "Two more days" });
    await saveOrder(s.buyer, po.id, {
      supplyType: po.supplyType,
      lines: [
        { ...s.line({ unitPrice: "6000", quantity: "4" }), id: crew!.id },
        s.line({ description: "Extra days", quantity: "6", unitPrice: "6000" }),
      ],
    });
    expect((await submitOrder(s.buyer, po.id)).status).toBe("SUBMITTED");
    await withdrawAmendment(s.buyer, po.id);
    const restored = await getOrder(s.owner, po.id);
    expect(restored.order.status).toBe("APPROVED");
    expect(restored.order.lines).toHaveLength(1);
    expect(restored.order.subtotalMinor).toBe(24_000_00n);
    expect((await s.budget()).committedMinor).toBe(24_000_00n);

    // Approved this time: the new line gets its own commitment.
    await startAmendment(s.buyer, po.id, { reason: "Two more days" });
    await saveOrder(s.buyer, po.id, {
      supplyType: po.supplyType,
      lines: [
        { ...s.line({ unitPrice: "6000", quantity: "4" }), id: crew!.id },
        s.line({ description: "Extra days", quantity: "6", unitPrice: "6000" }),
      ],
    });
    await submitOrder(s.buyer, po.id);
    const third = await approveOrder(s.finance, po.id);
    expect(third.revision).toBe(3);
    expect((await s.budget()).committedMinor).toBe(60_000_00n);
    expect(await db.purchaseOrderRevision.count({ where: { purchaseOrderId: po.id } })).toBe(3);
  });

  it("keeps billed cost out of the new commitment when a part-billed order is amended", async () => {
    const s = await setup();
    const po = await s.order("SERVICES", [s.line({ description: "Stage crew", quantity: "4" })]);
    await submitOrder(s.buyer, po.id);
    await approveOrder(s.finance, po.id);
    const bill = await draftBillFromOrder(s.finance, po.id);
    const drafted = await getBill(s.finance, bill.id);
    await saveBillDraft(s.finance, bill.id, {
      vendorInvoiceNumber: "INV-9",
      billDate: "2026-10-02",
      dueDate: "2026-11-01",
      currency: "INR",
      supplyType: drafted.supplyType,
      lines: drafted.lines.map((l) => ({
        description: l.description,
        quantity: "1",
        unitPrice: "6500",
        taxRateId: l.taxRateId,
        accountId: l.accountId,
        projectId: l.projectId,
        budgetLineId: l.budgetLineId,
        commitmentId: l.commitmentId,
        purchaseOrderLineId: l.purchaseOrderLineId,
      })),
    });
    await submitBill(s.finance, bill.id);
    await approveBill(s.finance, bill.id);
    expect(await s.budget()).toMatchObject({
      actualMinor: 6_500_00n,
      committedMinor: 19_500_00n,
    });

    // Cheaper, so it applies on submission even with a zero threshold.
    await startAmendment(s.buyer, po.id, { reason: "Rate agreed at 6,000" });
    const [crew] = await s.lines(po.id);
    await saveOrder(s.buyer, po.id, {
      supplyType: po.supplyType,
      lines: [{ ...s.line({ unitPrice: "6000", quantity: "4" }), id: crew!.id }],
    });
    expect((await submitOrder(s.buyer, po.id)).status).toBe("APPROVED");
    // 24,000 ordered, 6,500 billed: 17,500 still committed.
    expect(await s.budget()).toMatchObject({
      actualMinor: 6_500_00n,
      committedMinor: 17_500_00n,
    });
  });

  it("cancels an untouched approved order and releases its commitment", async () => {
    const s = await setup();
    const po = await s.order("CONSUMABLES");
    await submitOrder(s.buyer, po.id);
    await approveOrder(s.finance, po.id);
    expect((await s.budget()).committedMinor).toBe(13_000_00n);
    await expect(cancelOrder(s.buyer, po.id, { reason: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await cancelOrder(s.finance, po.id, { reason: "Bought elsewhere" });
    expect((await s.budget()).committedMinor).toBe(0n);
  });

  it("lets procurement keep vendors but not their bank details or TDS", async () => {
    const s = await setup();
    await updateVendor(s.finance, s.vendor.id, {
      name: s.vendor.name,
      countryCode: "IN",
      currency: "INR",
      paymentTermsDays: "30",
      gstin: s.vendor.gstin,
      bankAccountName: "Vendor Co",
      bankAccountNumber: "001122334455",
      bankIfsc: "HDFC0001234",
      tdsSection: "194C",
      tdsRate: "2",
    });
    const seen = await getVendor(s.buyer, s.vendor.id);
    expect(seen.bankAccountNumber).toBeNull();
    await updateVendor(s.buyer, s.vendor.id, {
      name: "Renamed vendor",
      countryCode: "IN",
      currency: "INR",
      paymentTermsDays: "45",
      gstin: s.vendor.gstin,
      bankAccountNumber: "999",
      tdsRate: "",
    });
    const after = await getVendor(s.finance, s.vendor.id);
    expect(after).toMatchObject({
      name: "Renamed vendor",
      paymentTermsDays: 45,
      bankAccountNumber: "001122334455",
      tdsSection: "194C",
      tdsRateBps: 200,
    });
  });
});
