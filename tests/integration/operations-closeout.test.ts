import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  approveWork,
  confirmAssignment,
  proposeAssignment,
  recordWork,
} from "@/server/crew/assignments";
import { addCrewRate, createCrewMember } from "@/server/crew/members";
import { createSettlement } from "@/server/crew/settlements";
import { dispatchEquipment, reserveEquipment, returnEquipment } from "@/server/equipment/bookings";
import { adjustStock, createItem, saveCategory } from "@/server/equipment/inventory";
import { approveBill, getBill, saveBillDraft, submitBill } from "@/server/finance/bills";
import { draftBillFromOrder } from "@/server/procurement/billing";
import {
  approveOrder,
  closeOrder,
  createOrder,
  recordReceipt,
  saveOrder,
  submitOrder,
} from "@/server/procurement/orders";
import { getProjectBudget } from "@/server/projects/budget";
import { getCloseout, setCloseoutItem } from "@/server/projects/closeout";
import { CLOSEOUT_ITEMS } from "@/server/projects/closeout-rules";
import { changeProjectStatus } from "@/server/projects/projects";
import { saveRequirement } from "@/server/projects/resources";
import { ConflictError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { taxRate } from "../helpers/commercial";
import { giveBooks, makeVendor } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

/**
 * One project with all three kinds of operational record: a freelance
 * rigger paid through a vendor, cables from the store, and a hazer hired
 * from a rental house on a purchase order.
 */
async function setup() {
  const { entity, project } = await makeAcceptedProject();
  await giveBooks(entity.id);
  const owner = await makeActor("owner");
  const pm = await makeActor("project_manager");
  const coordinator = await makeActor("crew_coordinator");
  const warehouse = await makeActor("warehouse");
  const buyer = await makeActor("procurement");
  const finance = await makeActor("finance");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
  const [crewLine, stageLine] = await Promise.all([
    db.projectBudgetLine.findFirstOrThrow({ where: { projectId: project.id, category: "CREW" } }),
    db.projectBudgetLine.findFirstOrThrow({
      where: { projectId: project.id, category: "PRODUCTION" },
    }),
  ]);
  const requirement = await saveRequirement(pm, project.id, {
    kind: "CREW",
    name: "Rigger",
    quantity: "1",
    startDate: "2099-03-10",
    endDate: "2099-03-11",
    budgetLineId: crewLine.id,
    dayRate: "3000",
  });
  const crewVendor = await makeVendor({ gstin: null, pan: "ABCPR1234K" });
  const rigger = await createCrewMember(coordinator, {
    name: "Ravi Rigger",
    kind: "FREELANCER",
    vendorId: crewVendor.id,
  });
  await addCrewRate(coordinator, rigger.id, {
    type: "DAY",
    currency: "INR",
    amount: "3000",
    validFrom: "2026-01-01",
  });
  const store = await db.location.create({
    data: {
      code: "OPS-WH",
      name: "Store",
      type: "WAREHOUSE",
      countryCode: "IN",
      timezone: "Asia/Kolkata",
    },
  });
  const category = await saveCategory(owner, null, { name: "Cabling" });
  const cable = await createItem(warehouse, {
    sku: "OPS-CABLE",
    name: "Cable",
    categoryId: category.id,
    tracking: "QUANTITY",
    currency: "INR",
  });
  await adjustStock(warehouse, cable.id, {
    locationId: store.id,
    direction: "ADDED",
    quantity: "10",
    reason: "Count",
  });
  const rentalHouse = await makeVendor();
  const gst = await taxRate("GST18");

  const closeout = () => getCloseout(owner, project.id);
  const blockers = async (key: (typeof CLOSEOUT_ITEMS)[number]["key"]) =>
    (await closeout()).items.find((i) => i.key === key)!.blockers.map((b) => b.text);
  const integrity = async () => (await getProjectBudget(owner, project.id)).integrity;

  return {
    entity,
    project,
    owner,
    pm,
    coordinator,
    warehouse,
    buyer,
    finance,
    stageLine,
    requirement,
    rigger,
    store,
    cable,
    rentalHouse,
    gst,
    closeout,
    blockers,
    integrity,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Enters the vendor's invoice number on a drafted bill, then submits and approves it. */
async function passBill(s: Setup, billId: string, invoiceNumber: string) {
  const drafted = await getBill(s.finance, billId);
  if (!drafted.vendorInvoiceNumber) {
    await saveBillDraft(s.finance, billId, {
      vendorInvoiceNumber: invoiceNumber,
      billDate: "2026-10-02",
      dueDate: "2026-11-01",
      currency: drafted.currency,
      supplyType: drafted.supplyType,
      lines: drafted.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.toString(),
        unitPrice: (Number(l.unitPriceMinor) / 100).toString(),
        taxRateId: l.taxRateId,
        accountId: l.accountId,
        projectId: l.projectId,
        budgetLineId: l.budgetLineId,
        commitmentId: l.commitmentId,
        purchaseOrderLineId: l.purchaseOrderLineId,
      })),
    });
  }
  await submitBill(s.finance, billId);
  await approveBill(s.pm, billId);
}

async function hireHazer(s: Setup) {
  const po = await createOrder(s.buyer, s.entity.id, {
    vendorId: s.rentalHouse.id,
    kind: "RENTAL",
    projectId: s.project.id,
  });
  await saveOrder(s.buyer, po.id, {
    supplyType: po.supplyType,
    hireFrom: "2099-03-10",
    hireTo: "2099-03-11",
    lines: [
      {
        description: "Hazer",
        quantity: "1",
        unitPrice: "6500",
        taxRateId: s.gst.id,
        budgetLineId: s.stageLine.id,
      },
    ],
  });
  await submitOrder(s.buyer, po.id);
  const approved = await approveOrder(s.finance, po.id);
  const [line] = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
  return { po: approved, line: line! };
}

describe("closeout from the operational records", () => {
  it("holds each item open until crew, equipment and orders are finished, then closes cleanly", async () => {
    const s = await setup();
    expect(await s.closeout()).toMatchObject({ finalReport: false });
    expect(await s.blockers("CREW_SETTLED")).toEqual([]);

    // Crew: proposed, then unapproved work, unsettled work, an unapproved bill.
    const { assignment } = await proposeAssignment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      crewMemberId: s.rigger.id,
    });
    expect(await s.blockers("CREW_SETTLED")).toEqual([
      "Ravi Rigger is still proposed as Rigger. Confirm or cancel the booking.",
    ]);
    await confirmAssignment(s.pm, assignment.id);
    await recordWork(s.pm, assignment.id, { date: "2099-03-10" });
    await recordWork(s.pm, assignment.id, { date: "2099-03-11" });
    expect(await s.blockers("CREW_SETTLED")).toEqual([
      "Work by Ravi Rigger as Rigger isn't approved yet.",
    ]);
    await expect(
      setCloseoutItem(s.pm, s.project.id, { key: "CREW_SETTLED", state: "done" }),
    ).rejects.toThrow(/isn't approved yet/);
    await expect(
      setCloseoutItem(s.pm, s.project.id, {
        key: "CREW_SETTLED",
        state: "not_applicable",
        note: "No crew",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await approveWork(s.coordinator, assignment.id);
    expect(await s.blockers("CREW_SETTLED")).toEqual([
      "Ravi Rigger's approved work isn't settled yet.",
    ]);
    const { bill: crewBill } = await createSettlement(s.finance, s.entity.id, s.rigger.id);
    expect(await s.blockers("CREW_SETTLED")).toEqual([
      "Ravi Rigger's settlement bill isn't approved yet.",
    ]);
    // A crew settlement isn't also listed as an outstanding vendor bill.
    expect(await s.blockers("VENDOR_BILLS_RECEIVED")).toEqual([]);
    await passBill(s, crewBill.id, "RR-1");
    expect(await s.blockers("CREW_SETTLED")).toEqual([]);
    await setCloseoutItem(s.pm, s.project.id, { key: "CREW_SETTLED", state: "done" });

    // Vendor bills ticked off early: a later order reopens the item.
    await setCloseoutItem(s.pm, s.project.id, { key: "VENDOR_BILLS_RECEIVED", state: "done" });
    const { po, line } = await hireHazer(s);
    expect(await s.blockers("VENDOR_BILLS_RECEIVED")).toEqual([
      `${po.number} is still open. Bill and close it, or cancel it.`,
    ]);
    expect((await s.closeout()).outstanding).toContain("VENDOR_BILLS_RECEIVED");

    // Equipment: cables out from the store and the hired hazer on site.
    const [booking] = await reserveEquipment(s.pm, s.project.id, {
      itemId: s.cable.id,
      quantity: "5",
      startDate: "2099-03-10",
      endDate: "2099-03-11",
    });
    await dispatchEquipment(s.warehouse, booking!.id, { locationId: s.store.id, quantity: "5" });
    await recordReceipt(s.buyer, po.id, {
      receivedOn: "2026-10-01",
      quantities: { [line.id]: "1" },
    });
    expect(await s.blockers("EQUIPMENT_RETURNED")).toEqual([
      "5 × Cable still out with the project.",
      `1 × Hazer still on hire from ${s.rentalHouse.name} (${po.number}).`,
    ]);
    await expect(
      setCloseoutItem(s.pm, s.project.id, { key: "EQUIPMENT_RETURNED", state: "done" }),
    ).rejects.toThrow(/5 × Cable still out with the project\. \(and 1 more\)/);

    await returnEquipment(s.warehouse, booking!.id, { locationId: s.store.id, good: "5" });
    await recordReceipt(s.buyer, po.id, {
      kind: "RETURNED",
      receivedOn: "2026-10-02",
      quantities: { [line.id]: "1" },
    });
    expect(await s.blockers("EQUIPMENT_RETURNED")).toEqual([]);

    // The rental house's bill, drawn from the order, then the order closed.
    const hazerBill = await draftBillFromOrder(s.finance, po.id);
    expect((await s.blockers("VENDOR_BILLS_RECEIVED")).at(-1)).toBe(
      `${s.rentalHouse.name}'s bill isn't approved yet.`,
    );
    await passBill(s, hazerBill.id, "RH-9");
    await closeOrder(s.buyer, po.id, { reason: "Returned and billed" });
    expect(await s.blockers("VENDOR_BILLS_RECEIVED")).toEqual([]);
    expect(await s.integrity()).toEqual([]);

    for (const key of [
      "INVOICES_ISSUED",
      "PAYMENTS_COLLECTED",
      "EQUIPMENT_RETURNED",
      "EXPENSES_RECONCILED",
    ] as const) {
      await setCloseoutItem(s.pm, s.project.id, { key, state: "done" });
    }
    await setCloseoutItem(s.pm, s.project.id, {
      key: "FINAL_REPORT",
      state: "not_applicable",
      note: "Report waived",
    });
    expect((await s.closeout()).outstanding).toEqual([]);
    await changeProjectStatus(s.owner, s.project.id, { to: "COMPLETED" });
    await changeProjectStatus(s.owner, s.project.id, { to: "FINANCIAL_CLOSE" });
    await changeProjectStatus(s.owner, s.project.id, { to: "CLOSED" });
    const change = await db.projectStatusChange.findFirstOrThrow({
      where: { projectId: s.project.id, toStatus: "CLOSED" },
    });
    expect(change.override).toBe(false);
  });

  it("treats closing over records that aren't finished as an override, even with every item ticked", async () => {
    const s = await setup();
    for (const { key } of CLOSEOUT_ITEMS) {
      await setCloseoutItem(s.pm, s.project.id, { key, state: "not_applicable", note: "Ticked" });
    }
    const [booking] = await reserveEquipment(s.pm, s.project.id, {
      itemId: s.cable.id,
      quantity: "2",
      startDate: "2099-03-10",
      endDate: "2099-03-11",
    });
    await dispatchEquipment(s.warehouse, booking!.id, { locationId: s.store.id, quantity: "2" });
    await changeProjectStatus(s.owner, s.project.id, { to: "COMPLETED" });
    await changeProjectStatus(s.owner, s.project.id, { to: "FINANCIAL_CLOSE" });
    await expect(
      changeProjectStatus(s.owner, s.project.id, { to: "CLOSED" }),
    ).rejects.toMatchObject({
      fieldErrors: { reason: [expect.stringContaining("equipment returned")] },
    });
    await changeProjectStatus(s.owner, s.project.id, {
      to: "CLOSED",
      reason: "Cables written off with the venue",
    });
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { targetId: s.project.id, action: "project.status_changed" },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({ override: true, outstanding: ["EQUIPMENT_RETURNED"] });
  });
});

describe("operations integrity", () => {
  it("reports crew and order records that disagree with the project's costs", async () => {
    const s = await setup();
    const { assignment } = await proposeAssignment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      crewMemberId: s.rigger.id,
    });
    await confirmAssignment(s.pm, assignment.id);
    await recordWork(s.pm, assignment.id, { date: "2099-03-10" });
    await hireHazer(s);
    expect(await s.integrity()).toEqual([]);

    // Changed behind the services' backs.
    await db.crewWorkRecord.updateMany({
      where: { assignmentId: assignment.id },
      data: { date: new Date("2099-03-20T00:00:00Z") },
    });
    await db.crewAssignment.update({ where: { id: assignment.id }, data: { status: "CANCELLED" } });
    expect(await s.integrity()).toEqual([
      "The booking of Ravi Rigger as Rigger has ended but its commitment is still open.",
      "Work by Ravi Rigger is recorded outside the dates they were booked.",
    ]);
  });
});
