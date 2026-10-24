import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveWork, confirmAssignment, proposeAssignment } from "@/server/crew/assignments";
import { addCrewRate, createCrewMember } from "@/server/crew/members";
import { createSettlement } from "@/server/crew/settlements";
import {
  approveOrder,
  createOrder,
  saveOrder,
  startAmendment,
  submitOrder,
} from "@/server/procurement/orders";
import { acceptInvitation } from "@/server/portal/accept";
import { invitePortalUser } from "@/server/portal/access";
import { listClientInvoices, listSharedProjects } from "@/server/portal/client";
import {
  answerBooking,
  getMyBooking,
  listMyBookings,
  listMySettlements,
  submitTimesheetDay,
} from "@/server/portal/freelancer";
import { PORTAL_PERMISSIONS } from "@/server/portal/permissions";
import {
  getMyDetails,
  requestDetailsChange,
  updateMyContactDetails,
} from "@/server/portal/profile";
import { portalActorFor, type PortalActor } from "@/server/portal/session";
import {
  answerVendorOrder,
  getVendorOrder,
  listVendorBills,
  listVendorOrders,
  myInvoiceUploads,
  uploadVendorInvoice,
} from "@/server/portal/vendor";
import { saveRequirement } from "@/server/projects/resources";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { taxRate } from "../helpers/commercial";
import { giveBooks, makeVendor } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

const PASSWORD = "portal-password-1";
let people = 0;
const body = (text: string) => new Blob([text]).stream();

async function signUp(
  inviter: Awaited<ReturnType<typeof makeActor>>,
  org: { kind: "VENDOR" | "FREELANCER"; id: string },
  permissions = Object.keys(PORTAL_PERMISSIONS[org.kind]),
): Promise<PortalActor> {
  people += 1;
  const email = `supplier${people}@supplier${people}.test`;
  const { token } = await invitePortalUser(inviter, org, {
    name: `Supplier ${people}`,
    email,
    permissions,
  });
  await acceptInvitation(token, {
    email,
    name: `Supplier ${people}`,
    password: PASSWORD,
    confirm: PASSWORD,
  });
  return (await portalActorFor(await db.user.findUniqueOrThrow({ where: { email } })))!;
}

/** An approved rental order to a vendor, with an internal note the vendor must not see. */
async function approvedOrder() {
  const { entity, project } = await makeAcceptedProject();
  await giveBooks(entity.id);
  const buyer = await makeActor("procurement");
  const finance = await makeActor("finance");
  const vendor = await makeVendor();
  const stage = await db.projectBudgetLine.findFirstOrThrow({
    where: { projectId: project.id, category: "PRODUCTION" },
  });
  const po = await createOrder(buyer, entity.id, {
    vendorId: vendor.id,
    kind: "RENTAL",
    projectId: project.id,
  });
  await saveOrder(buyer, po.id, {
    supplyType: po.supplyType,
    hireFrom: "2099-03-10",
    hireTo: "2099-03-12",
    terms: "Delivered and collected by the vendor.",
    notes: "Internal: they quoted 9,000 last year.",
    lines: [
      {
        description: "Hazer",
        quantity: "2",
        unitPrice: "6500",
        taxRateId: (await taxRate("GST18")).id,
        budgetLineId: stage.id,
      },
    ],
  });
  await submitOrder(buyer, po.id);
  await approveOrder(finance, po.id);
  return { entity, project, buyer, finance, vendor, po };
}

describe("vendor portal", () => {
  it("shows the vendor its approved orders as approved, without internal notes or budget links", async () => {
    const { buyer, vendor, po } = await approvedOrder();
    const supplier = await signUp(buyer, { kind: "VENDOR", id: vendor.id });
    const [listed] = await listVendorOrders(supplier);
    expect(listed).toMatchObject({ id: po.id, state: "open", answer: null });
    const shown = await getVendorOrder(supplier, po.id);
    expect(shown.approved.lines).toHaveLength(1);
    expect(shown.approved.terms).toBe("Delivered and collected by the vendor.");
    const text = JSON.stringify(shown, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toMatch(/Internal|budgetLine|commitment|notes"/);

    // A draft order is never shown.
    const draft = await createOrder(buyer, po.legalEntityId, {
      vendorId: vendor.id,
      kind: "SERVICES",
      projectId: po.projectId,
    });
    await expect(getVendorOrder(supplier, draft.id)).rejects.toThrow(NotFoundError);
    expect((await listVendorOrders(supplier)).map((o) => o.id)).toEqual([po.id]);
  });

  it("records the vendor's answer for the approved revision and tells the buyer", async () => {
    const { buyer, vendor, po } = await approvedOrder();
    const supplier = await signUp(buyer, { kind: "VENDOR", id: vendor.id });
    await expect(
      answerVendorOrder(supplier, po.id, 1, { answer: "DECLINED", note: "" }),
    ).rejects.toThrow(ValidationError);
    await expect(answerVendorOrder(supplier, po.id, 2, { answer: "CONFIRMED" })).rejects.toThrow(
      ConflictError,
    );
    await answerVendorOrder(supplier, po.id, 1, { answer: "CONFIRMED", note: "Ready on the 9th" });
    await expect(answerVendorOrder(supplier, po.id, 1, { answer: "CONFIRMED" })).rejects.toThrow(
      ConflictError,
    );
    const note = await db.notification.findFirstOrThrow({
      where: { userId: buyer.id, kind: "portal.supplier_activity" },
    });
    expect(note.title).toMatch(/confirmed purchase order PO\//);

    // While HMBL amends it, the vendor keeps seeing the approved version and can't answer.
    await startAmendment(buyer, po.id, { reason: "One more hazer" });
    const shown = await getVendorOrder(supplier, po.id);
    expect(shown).toMatchObject({ state: "amending", canAnswer: false });
    expect(shown.approved.revision).toBe(1);
    const response = await db.purchaseOrderVendorResponse.findFirstOrThrow({
      where: { purchaseOrderId: po.id },
    });
    await expect(
      db.purchaseOrderVendorResponse.update({ where: { id: response.id }, data: { note: "x" } }),
    ).rejects.toThrow(/append-only/);
  });

  it("uploads an invoice to the order's documents and tells Finance", async () => {
    const { buyer, finance, vendor, po } = await approvedOrder();
    const supplier = await signUp(buyer, { kind: "VENDOR", id: vendor.id });
    const input = {
      vendorInvoiceNumber: "INV-501",
      invoiceDate: "2026-10-20",
      total: "15340",
      fileName: "inv-501.pdf",
    };
    await expect(
      uploadVendorInvoice(supplier, po.id, { ...input, fileName: "run.exe" }, body("x")),
    ).rejects.toThrow(ValidationError);
    const upload = await uploadVendorInvoice(supplier, po.id, input, body("%PDF invoice"));
    expect(upload).toMatchObject({ totalMinor: 15_340_00n, currency: "INR" });
    await expect(uploadVendorInvoice(supplier, po.id, input, body("again"))).rejects.toThrow(
      ValidationError,
    );
    const doc = await db.recordDocument.findUniqueOrThrow({ where: { id: upload.documentId } });
    expect(doc).toMatchObject({
      recordType: "PURCHASE_ORDER",
      recordId: po.id,
      category: "INVOICE",
      uploadedById: supplier.id,
    });
    expect((await myInvoiceUploads(supplier)).map((u) => u.id)).toEqual([upload.id]);
    expect(
      await db.notification.count({
        where: { userId: finance.id, kind: "portal.supplier_activity" },
      }),
    ).toBe(1);
    // Bills appear only once Finance has entered and submitted them.
    expect(await listVendorBills(supplier)).toEqual([]);
  });

  it("changes contact details directly, but bank and tax details only by request", async () => {
    const { buyer, vendor } = await approvedOrder();
    const supplier = await signUp(buyer, { kind: "VENDOR", id: vendor.id });
    await updateMyContactDetails(supplier, {
      email: "Accounts@Vendor.test",
      phone: "+91 98000 00000",
      bankAccountNumber: "999999999",
      gstin: "27AAAAA0000A1Z5",
    });
    const after = await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } });
    expect(after).toMatchObject({
      email: "accounts@vendor.test",
      phone: "+91 98000 00000",
      bankAccountNumber: vendor.bankAccountNumber,
      gstin: vendor.gstin,
    });
    await requestDetailsChange(supplier, { details: "New bank account: HDFC 5010…" });
    const details = await getMyDetails(supplier);
    expect(details.requests).toHaveLength(1);
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { action: "vendor.updated", actorId: supplier.id },
    });
    expect(audit.metadata).toMatchObject({ via: "portal" });
  });
});

/** A proposed booking for a freelancer on the accepted project. */
async function proposedBooking() {
  const { entity, project } = await makeAcceptedProject();
  await giveBooks(entity.id);
  const pm = await makeActor("project_manager");
  const coordinator = await makeActor("crew_coordinator");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
  const crewLine = await db.projectBudgetLine.findFirstOrThrow({
    where: { projectId: project.id, category: "CREW" },
  });
  const requirement = await saveRequirement(pm, project.id, {
    kind: "CREW",
    name: "Rigger",
    quantity: "4",
    startDate: "2099-03-10",
    endDate: "2099-03-11",
    budgetLineId: crewLine.id,
    dayRate: "3000",
  });
  const vendor = await makeVendor({
    gstin: null,
    pan: "ABCPR1234K",
    tdsSection: "194J",
    tdsRate: "10",
  });
  people += 1;
  const freelancer = await createCrewMember(coordinator, {
    name: `Ravi Rigger ${people}`,
    kind: "FREELANCER",
    vendorId: vendor.id,
    skills: "Rigging",
  });
  await addCrewRate(coordinator, freelancer.id, {
    type: "DAY",
    currency: "INR",
    amount: "3000",
    validFrom: "2026-01-01",
  });
  const { assignment } = await proposeAssignment(pm, project.id, {
    requirementId: requirement.id,
    crewMemberId: freelancer.id,
    callTime: "07:00",
  });
  const ravi = await signUp(coordinator, { kind: "FREELANCER", id: freelancer.id });
  return { entity, project, pm, coordinator, freelancer, assignment, ravi };
}

describe("freelancer portal", () => {
  it("shows only their own bookings, with call details and their own rate", async () => {
    const { assignment, ravi, pm, project } = await proposedBooking();
    const other = await proposedBooking();
    expect((await listMyBookings(ravi)).map((b) => b.id)).toEqual([assignment.id]);
    await expect(getMyBooking(ravi, other.assignment.id)).rejects.toThrow(NotFoundError);
    const mine = await getMyBooking(ravi, assignment.id);
    expect(mine).toMatchObject({ callTime: "07:00", dayRateMinor: 3_000_00n, canAnswer: true });
    const text = JSON.stringify(mine, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toMatch(/budget|commitment|legalEntityId|notes"/);
    // A freelancer is not a client: shared projects and invoices are closed to them.
    await expect(listSharedProjects(ravi)).rejects.toThrow(ForbiddenError);
    await expect(listClientInvoices(ravi)).rejects.toThrow(ForbiddenError);
    void pm;
    void project;
  });

  it("says yes for the coordinator to confirm, then records days for the project to approve", async () => {
    const s = await proposedBooking();
    await answerBooking(s.ravi, s.assignment.id, { answer: "CONFIRMED", note: "Happy to" });
    await expect(answerBooking(s.ravi, s.assignment.id, { answer: "CONFIRMED" })).rejects.toThrow(
      ConflictError,
    );
    const told = await db.notification.findFirstOrThrow({
      where: { userId: s.pm.id, kind: "portal.supplier_activity" },
    });
    expect(told.title).toMatch(/can do Rigger/);
    // Still proposed: confirming is HMBL's step.
    expect((await getMyBooking(s.ravi, s.assignment.id)).status).toBe("PROPOSED");
    await expect(
      submitTimesheetDay(s.ravi, s.assignment.id, { date: "2099-03-10" }),
    ).rejects.toThrow(ConflictError);

    await confirmAssignment(s.pm, s.assignment.id);
    await submitTimesheetDay(s.ravi, s.assignment.id, { date: "2099-03-10", overtimeMinutes: 60 });
    await submitTimesheetDay(s.ravi, s.assignment.id, { date: "2099-03-11", expenses: "450" });
    await expect(
      submitTimesheetDay(s.ravi, s.assignment.id, { date: "2099-03-20" }),
    ).rejects.toThrow(ValidationError);
    const days = await db.crewWorkRecord.findMany({ where: { assignmentId: s.assignment.id } });
    expect(days.map((d) => d.createdById)).toEqual([s.ravi.id, s.ravi.id]);

    await approveWork(s.coordinator, s.assignment.id);
    await expect(
      submitTimesheetDay(s.ravi, s.assignment.id, { date: "2099-03-10" }),
    ).rejects.toThrow(ConflictError);

    const finance = await makeActor("finance");
    expect((await listMySettlements(s.ravi)).approvedUnsettled).toBe(2);
    await createSettlement(finance, s.entity.id, s.freelancer.id);
    const { settlements, approvedUnsettled } = await listMySettlements(s.ravi);
    expect(approvedUnsettled).toBe(0);
    expect(settlements[0]).toMatchObject({ days: 2, state: "checking" });
  });

  it("declines with a reason, which ends the booking", async () => {
    const s = await proposedBooking();
    await expect(
      answerBooking(s.ravi, s.assignment.id, { answer: "DECLINED", note: "" }),
    ).rejects.toThrow(ValidationError);
    await answerBooking(s.ravi, s.assignment.id, { answer: "DECLINED", note: "Away that week" });
    const a = await db.crewAssignment.findUniqueOrThrow({ where: { id: s.assignment.id } });
    expect(a).toMatchObject({ status: "DECLINED", endedReason: "Away that week" });
    expect(
      await db.notification.count({
        where: { userId: s.pm.id, title: { contains: "declined Rigger" } },
      }),
    ).toBe(1);
  });
});

describe("isolation between organisations", () => {
  it("keeps every vendor to its own orders, uploads and requests", async () => {
    const a = await approvedOrder();
    const b = await approvedOrder();
    const vendorA = await signUp(a.buyer, { kind: "VENDOR", id: a.vendor.id });
    const vendorB = await signUp(b.buyer, { kind: "VENDOR", id: b.vendor.id });
    expect((await listVendorOrders(vendorB)).map((o) => o.id)).toEqual([b.po.id]);
    await expect(getVendorOrder(vendorB, a.po.id)).rejects.toThrow(NotFoundError);
    await expect(answerVendorOrder(vendorB, a.po.id, 1, { answer: "CONFIRMED" })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      uploadVendorInvoice(
        vendorB,
        a.po.id,
        { vendorInvoiceNumber: "X", invoiceDate: "2026-10-01", total: "1", fileName: "x.pdf" },
        body("x"),
      ),
    ).rejects.toThrow(NotFoundError);
    // And the database refuses it even when asked directly.
    await expect(
      db.purchaseOrderVendorResponse.create({
        data: {
          purchaseOrderId: a.po.id,
          revision: 1,
          accountId: vendorB.accountId,
          answer: "CONFIRMED",
        },
      }),
    ).rejects.toThrow(/order's vendor/);
    await expect(
      db.portalDetailsRequest.create({
        data: { accountId: vendorB.accountId, vendorId: a.vendor.id, details: "x" },
      }),
    ).rejects.toThrow(/own record/);
    void vendorA;
  });

  it("keeps each kind of portal user to its own services", async () => {
    const order = await approvedOrder();
    const booking = await proposedBooking();
    const vendor = await signUp(order.buyer, { kind: "VENDOR", id: order.vendor.id });
    await expect(listMyBookings(vendor)).rejects.toThrow(ForbiddenError);
    await expect(listVendorOrders(booking.ravi)).rejects.toThrow(ForbiddenError);
    await expect(listSharedProjects(vendor)).rejects.toThrow(ForbiddenError);
    await expect(
      db.crewAssignmentResponse.create({
        data: {
          assignmentId: booking.assignment.id,
          accountId: vendor.accountId,
          answer: "CONFIRMED",
        },
      }),
    ).rejects.toThrow(/booked freelancer/);
  });

  it("checks each portal permission, and keeps payments off unless granted", async () => {
    const { buyer, vendor } = await approvedOrder();
    const limited = await signUp(buyer, { kind: "VENDOR", id: vendor.id }, ["orders.view"]);
    await expect(listVendorBills(limited)).rejects.toThrow(ForbiddenError);
    await expect(myInvoiceUploads(limited)).rejects.toThrow(ForbiddenError);
    await expect(getMyDetails(limited)).rejects.toThrow(ForbiddenError);
    const [order] = await listVendorOrders(limited);
    await expect(
      answerVendorOrder(limited, order!.id, order!.revision, { answer: "CONFIRMED" }),
    ).rejects.toThrow(ForbiddenError);
  });
});
