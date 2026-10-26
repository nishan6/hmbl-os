import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { confirmAssignment, proposeAssignment } from "@/server/crew/assignments";
import { addUnavailability, createCrewMember } from "@/server/crew/members";
import { createOpportunity } from "@/server/crm/pipeline";
import { recordReceipt } from "@/server/finance/receipts";
import { reportIncident } from "@/server/production/incidents";
import { addNote, postStatusUpdate } from "@/server/production/log";
import { setLineForecast } from "@/server/projects/budget";
import { saveRequirement } from "@/server/projects/resources";
import { executiveDashboard } from "@/server/reports/executive";
import { productionDashboard } from "@/server/reports/production";
import { projectManagerDashboard } from "@/server/reports/projects";
import { ForbiddenError } from "@/lib/errors";
import { METRICS } from "@/lib/metrics";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { stages } from "../helpers/crm";
import {
  giveBooks,
  issueSimpleInvoice,
  makeBankAccount,
  makeBillableClient,
} from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

const OCT_31 = new Date("2026-10-31T06:00:00Z");
/** Nine days before the accepted project's show (10–12 March 2099). */
const MAR_1 = new Date("2099-03-01T06:00:00Z");

async function setup() {
  const s = await makeAcceptedProject();
  const pm = await makeActor("project_manager");
  await db.project.update({ where: { id: s.project.id }, data: { projectManagerId: pm.id } });
  return { ...s, pm, owner: await makeActor("owner") };
}

describe("the executive dashboard", () => {
  it("shows money only to people with sensitive reports, and each section only with its module", async () => {
    const s = await setup();
    const sales = await makeActor("sales");
    const d = await executiveDashboard(sales, s.entity.id, OCT_31);
    expect(d.sensitive).toBe(false);
    expect(d.pipeline).toBeNull();
    expect(d.quotes).toBeNull();
    expect(d.finance).toBeNull();
    expect(d.financeHidden).toBe("sensitive");
    expect(d.projects).toMatchObject({ active: 1, contracted: null, exceptions: null });

    // Finance sees money but has no CRM access, so no pipeline.
    const finance = await makeActor("finance");
    const f = await executiveDashboard(finance, s.entity.id, OCT_31);
    expect(f.sensitive).toBe(true);
    expect(f.pipeline).toBeNull();
    expect(f.financeHidden).toBe("no_books");

    const show = await makeActor("show_crew");
    await expect(executiveDashboard(show, s.entity.id, OCT_31)).rejects.toThrow();
    const elsewhere = await makeScopedActor("owner", (await makeAcceptedProject()).entity.id);
    await expect(executiveDashboard(elsewhere, s.entity.id, OCT_31)).rejects.toThrow();
  });

  it("weights the pipeline, counts quotes waiting and sums contracted revenue per currency", async () => {
    const s = await setup();
    const st = await stages();
    const sales = await makeActor("sales");
    const open = Object.values(st).find((x) => x.kind === "OPEN" && x.probabilityBps)!;
    await createOpportunity(sales, {
      legalEntityId: s.entity.id,
      clientId: s.client.id,
      title: "Product launch",
      stageId: open.id,
      currency: "INR",
      expectedValue: "200000",
      probability: "25",
    });
    await createOpportunity(sales, {
      legalEntityId: s.entity.id,
      clientId: s.client.id,
      title: "Tour",
      currency: "USD",
      expectedValue: "1000",
      probability: "50",
    });
    await createOpportunity(sales, {
      legalEntityId: s.entity.id,
      clientId: s.client.id,
      title: "No value yet",
      currency: "INR",
    });
    const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: s.quote.id } });
    await db.quoteVersion.update({
      where: { id: version.id },
      data: { status: "PENDING_APPROVAL" },
    });

    const d = await executiveDashboard(s.owner, s.entity.id, OCT_31);
    expect(d.pipeline).toEqual({
      count: 3,
      value: { INR: 20_000_000n, USD: 100_000n },
      weighted: { INR: 5_000_000n, USD: 50_000n },
    });
    expect(d.quotes).toEqual({ count: 1, value: { INR: version.totalMinor } });
    // Stage build 1,00,000 plus show crew 4 × 2 days × 5,000.
    expect(d.projects?.contracted).toEqual({ INR: 14_000_000n });
    expect(d.projects?.exceptions).toEqual([]);
  });

  it("lists projects forecast above their revised budget", async () => {
    const s = await setup();
    const stage = await db.projectBudgetLine.findFirstOrThrow({
      where: { projectId: s.project.id, description: "Stage build" },
    });
    await setLineForecast(s.pm, stage.id, { forecast: "75000", note: "Steel prices" });
    const d = await executiveDashboard(s.owner, s.entity.id, OCT_31);
    expect(d.projects?.exceptions).toMatchObject([
      { id: s.project.id, revisedMinor: 8_400_000n, forecastMinor: 9_900_000n },
    ]);
  });

  it("takes invoiced revenue, collections, money owed and cash from the books", async () => {
    const s = await setup();
    await giveBooks(s.entity.id);
    const finance = await makeActor("finance");
    const client = await makeBillableClient();
    const invoice = await issueSimpleInvoice(finance, s.entity.id, client.id);
    // Last financial year: not counted.
    await issueSimpleInvoice(finance, s.entity.id, client.id, {
      amount: "5000",
      invoiceDate: "2026-03-15",
    });
    const bank = await makeBankAccount(s.entity.id);
    await recordReceipt(finance, s.entity.id, {
      clientId: client.id,
      depositAccountId: bank.ledgerAccountId,
      date: "2026-10-20",
      method: "BANK_TRANSFER",
      currency: "INR",
      amount: "100000",
      allocations: [{ invoiceId: invoice.id, amount: "100000" }],
    });

    const d = await executiveDashboard(s.owner, s.entity.id, OCT_31);
    expect(d.range.from).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(d.financeHidden).toBeNull();
    expect(d.finance).toMatchObject({
      invoicedMinor: 10_000_000n,
      invoices: 1,
      collectedMinor: 10_000_000n,
      receipts: 1,
      cashMinor: 10_000_000n,
    });
    // 1,18,000 + 5,900 invoiced, 1,00,000 received; only March's invoice is past its due date.
    expect(d.finance?.receivables).toEqual({ totalMinor: 2_390_000n, overdueMinor: 590_000n });
    expect(d.finance?.payables).toEqual({ totalMinor: 0n, overdueMinor: 0n });
    expect(d.finance?.profit).toMatchObject({ projects: 0, revenueMinor: 0n, marginBps: null });
  });

  it("finds crew clashes and the shows coming up", async () => {
    const s = await setup();
    const coordinator = await makeActor("crew_coordinator");
    const member = await createCrewMember(coordinator, { name: "Nila Das", kind: "EMPLOYEE" });
    const { assignment } = await proposeAssignment(s.pm, s.project.id, {
      crewMemberId: member.id,
      role: "Stage manager",
      startDate: "2099-03-10",
      endDate: "2099-03-12",
    });
    await confirmAssignment(s.pm, assignment.id);
    let d = await executiveDashboard(s.owner, s.entity.id, MAR_1);
    expect(d.conflicts?.crew).toEqual([]);
    expect(d.shows?.map((x) => x.id)).toEqual([s.project.id]);

    await addUnavailability(coordinator, member.id, { startDate: "2099-03-11", reason: "Wedding" });
    d = await executiveDashboard(s.owner, s.entity.id, MAR_1);
    expect(d.conflicts?.crew).toMatchObject([{ id: assignment.id, bookings: 0, timeOff: 1 }]);
    // Ten weeks before the show it isn't "coming up" yet.
    const early = await executiveDashboard(s.owner, s.entity.id, new Date("2098-12-30T06:00:00Z"));
    expect(early.shows).toEqual([]);
  });
});

describe("the project manager dashboard", () => {
  it("starts with your own projects and shows costs only to people who may see them", async () => {
    const s = await setup();
    const d = await projectManagerDashboard(s.pm);
    expect(d).toMatchObject({ scope: "mine", mineCount: 1 });
    expect(d.rows.map((r) => r.id)).toEqual([s.project.id]);
    expect(d.rows[0]!.budget).toMatchObject({ revisedMinor: 8_400_000n, over: false });
    // The advance is due on acceptance and nothing is invoiced yet.
    expect(d.rows[0]!.billing).toMatchObject([{ label: expect.any(String), overdue: false }]);

    const viewer = await makeActor("viewer");
    const v = await projectManagerDashboard(viewer);
    expect(v.scope).toBe("all");
    expect(v.rows[0]!.budget).toBeNull();

    const elsewhere = await makeScopedActor(
      "project_manager",
      (await makeAcceptedProject()).entity.id,
    );
    expect(
      (await projectManagerDashboard(elsewhere, { scope: "all" })).rows.map((r) => r.id),
    ).not.toContain(s.project.id);
    await expect(projectManagerDashboard(await makeActor("show_crew"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("counts crew confirmations, equipment and missing approvals", async () => {
    const s = await setup();
    await saveRequirement(s.pm, s.project.id, {
      kind: "CREW",
      name: "Rigger",
      quantity: "2",
      startDate: "2099-03-10",
      endDate: "2099-03-12",
    });
    await saveRequirement(s.pm, s.project.id, {
      kind: "EQUIPMENT",
      name: "Moving heads",
      quantity: "12",
      startDate: "2099-03-10",
      endDate: "2099-03-12",
    });
    const coordinator = await makeActor("crew_coordinator");
    for (const [name, confirm] of [
      ["Arjun", true],
      ["Bina", false],
    ] as const) {
      const member = await createCrewMember(coordinator, { name, kind: "EMPLOYEE" });
      const { assignment } = await proposeAssignment(s.pm, s.project.id, {
        crewMemberId: member.id,
        role: "Rigger",
        startDate: "2099-03-10",
        endDate: "2099-03-12",
      });
      if (confirm) await confirmAssignment(s.pm, assignment.id);
    }
    const [row] = (await projectManagerDashboard(s.pm)).rows;
    expect(row!.readiness).toMatchObject({
      crew: { needed: 2, confirmed: 1, proposed: 1 },
      equipment: { needed: 12, reserved: 0, shortfalls: 0 },
      approvals: { changeOrders: 0, purchaseOrders: 0, trips: 0 },
      clientInputs: 0,
    });
  });
});

describe("the production dashboard", () => {
  it("shows the shows coming up with status, issues and changes, never who was involved", async () => {
    const s = await setup();
    const crew = await makeActor("show_crew");
    await expect(productionDashboard(crew, MAR_1)).rejects.toBeInstanceOf(ForbiddenError);

    await postStatusUpdate(s.pm, s.project.id, { status: "ON_TRACK", message: "Trucks loaded" });
    await addNote(s.pm, s.project.id, { body: "Venue wants the cable plan by Friday" });
    await reportIncident(s.pm, s.project.id, {
      occurredAt: new Date(Date.now() - 3_600_000),
      category: "INJURY",
      severity: "HIGH",
      title: "Hand cut on a case latch",
      description: "Loader cut his hand closing a flight case.",
      peopleInvolved: "Ravi (loader)",
    });

    const d = await productionDashboard(s.pm, MAR_1);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({
      id: s.project.id,
      today: false,
      latest: { status: "ON_TRACK", message: "Trucks loaded" },
      incidents: { HIGH: 1, total: 1 },
      contacts: [{ role: "Project manager", name: s.pm.name }],
    });
    expect(d.changes.map((c) => c.kind).sort()).toEqual(["note", "update"]);
    expect(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain(
      "Ravi",
    );

    // After the last show day it drops off.
    expect((await productionDashboard(s.pm, new Date("2099-03-13T06:00:00Z"))).rows).toEqual([]);
  });
});

describe("metric definitions", () => {
  it("define every figure with a source", () => {
    for (const m of Object.values(METRICS)) {
      expect(m.definition.length).toBeGreaterThan(20);
      expect(m.source.length).toBeGreaterThan(3);
    }
  });
});
