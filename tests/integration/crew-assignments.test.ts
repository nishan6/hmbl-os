import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  approveWork,
  callSheet,
  confirmAssignment,
  crewAvailability,
  endAssignment,
  projectCrew,
  proposeAssignment,
  recordWork,
  removeWork,
  substituteAssignment,
  updateAssignment,
} from "@/server/crew/assignments";
import { addCrewRate, addUnavailability, createCrewMember } from "@/server/crew/members";
import { createSettlement, settleableWork } from "@/server/crew/settlements";
import { approveBill, discardBill, getBill, submitBill } from "@/server/finance/bills";
import { getProjectBudget } from "@/server/projects/budget";
import { saveRequirement } from "@/server/projects/resources";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { day, giveBooks, makeVendor } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

/**
 * The accepted project's crew line is 24,000 (4 × 2 days at 3,000). A
 * requirement for riggers on 10–11 March 2099 is paid from it, and a
 * freelancer paid through a vendor (194J at 10%, no GSTIN) has a 3,000 day rate.
 */
async function setup() {
  const { entity, project } = await makeAcceptedProject();
  await giveBooks(entity.id);
  const owner = await makeActor("owner");
  const pm = await makeActor("project_manager");
  const coordinator = await makeActor("crew_coordinator");
  const finance = await makeActor("finance");
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
  const freelancer = await createCrewMember(coordinator, {
    name: "Ravi Rigger",
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
  const budget = async () => (await getProjectBudget(owner, project.id)).totals;
  return {
    entity,
    project,
    owner,
    pm,
    coordinator,
    finance,
    crewLine,
    requirement,
    vendor,
    freelancer,
    budget,
  };
}

describe("crew bookings", () => {
  it("books a freelancer from a requirement, commits their cost and settles approved work", async () => {
    const s = await setup();
    const { assignment, clashes } = await proposeAssignment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      crewMemberId: s.freelancer.id,
      callTime: "07:00",
    });
    expect(clashes).toEqual([]);
    expect(assignment).toMatchObject({
      role: "Rigger",
      startDate: day("2099-03-10"),
      endDate: day("2099-03-11"),
      budgetLineId: s.crewLine.id,
      dayRateMinor: 3_000_00n,
      status: "PROPOSED",
    });
    // Proposing commits nothing.
    expect((await s.budget()).committedMinor).toBe(0n);

    await confirmAssignment(s.pm, assignment.id);
    expect((await s.budget()).committedMinor).toBe(6_000_00n);

    // An extension to a third day replaces the commitment.
    await updateAssignment(s.pm, assignment.id, {
      role: "Rigger",
      startDate: "2099-03-10",
      endDate: "2099-03-12",
      callTime: "07:00",
    });
    expect((await s.budget()).committedMinor).toBe(9_000_00n);
    const sheet = await callSheet(s.pm, s.project.id, day("2099-03-12"));
    expect(sheet.crew.map((c) => [c.crewMember.name, c.callTime])).toEqual([
      ["Ravi Rigger", "07:00"],
    ]);

    // Two full days with 2 h 30 min overtime, one half day, ₹450 of expenses.
    await recordWork(s.pm, assignment.id, { date: "2099-03-10", overtimeMinutes: 150 });
    await recordWork(s.pm, assignment.id, { date: "2099-03-11", expenses: "450" });
    await recordWork(s.pm, assignment.id, { date: "2099-03-12", day: "HALF" });
    await expect(recordWork(s.pm, assignment.id, { date: "2099-03-13" })).rejects.toMatchObject({
      fieldErrors: { date: [expect.any(String)] },
    });
    await expect(approveWork(s.coordinator, assignment.id)).resolves.toBe(3);
    await expect(recordWork(s.pm, assignment.id, { date: "2099-03-10" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    // Finance turns the approved work into a draft bill to the freelancer's vendor.
    const pending = await settleableWork(s.finance, s.entity.id);
    expect(pending).toHaveLength(1);
    // 2 × 3,000 + 1,500 + 2.5 h × 450 + 450 = 9,075.
    expect(pending[0]!.totalMinor).toBe(9_075_00n);
    const { bill } = await createSettlement(s.finance, s.entity.id, s.freelancer.id);
    expect(await settleableWork(s.finance, s.entity.id)).toEqual([]);
    await expect(createSettlement(s.finance, s.entity.id, s.freelancer.id)).rejects.toThrow();
    const draft = await getBill(s.finance, bill.id);
    expect(draft).toMatchObject({
      status: "DRAFT",
      vendorId: s.vendor.id,
      subtotalMinor: 9_075_00n,
      taxMinor: 0n,
      tdsSection: "194J",
      // 10% of 9,075, rounded to the rupee.
      tdsMinor: 908_00n,
    });
    expect(draft.lines.map((l) => [l.description, l.amountMinor, l.commitmentId !== null])).toEqual(
      [
        [`${s.project.number} Rigger: 2 days`, 6_000_00n, true],
        [`${s.project.number} Rigger: 1 half day`, 1_500_00n, false],
        [`${s.project.number} Rigger: overtime 2 h 30 min`, 1_125_00n, false],
        [`${s.project.number} Rigger: expenses`, 450_00n, false],
      ],
    );

    // The project manager approves it: the fees draw the commitment down.
    await submitBill(s.finance, bill.id);
    await approveBill(s.pm, bill.id);
    const totals = await s.budget();
    expect(totals.actualMinor).toBe(9_075_00n);
    // 9,000 committed less the 6,000 billed against it; the rest stays until closed.
    expect(totals.committedMinor).toBe(3_000_00n);
    await endAssignment(s.pm, assignment.id, "CANCELLED", { reason: "Show over" });
    expect((await s.budget()).committedMinor).toBe(0n);
    expect((await s.budget()).actualMinor).toBe(9_075_00n);
  });

  it("stops a double booking unless crew approval overrides it with a reason", async () => {
    const s = await setup();
    const first = await proposeAssignment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      crewMemberId: s.freelancer.id,
    });
    await confirmAssignment(s.pm, first.assignment.id);
    const { project: other } = await makeAcceptedProject();
    await db.project.update({ where: { id: other.id }, data: { projectManagerId: s.pm.id } });
    const second = await proposeAssignment(s.owner, other.id, {
      crewMemberId: s.freelancer.id,
      role: "Rigger",
      startDate: "2099-03-11",
      endDate: "2099-03-12",
    });
    expect(second.clashes).toEqual([
      expect.objectContaining({ kind: "booking", hard: true, id: first.assignment.id }),
    ]);
    const pm = await makeActor("project_manager");
    await db.project.update({ where: { id: other.id }, data: { projectManagerId: pm.id } });
    await expect(confirmAssignment(s.pm, second.assignment.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      confirmAssignment(s.pm, second.assignment.id, { overrideReason: "Short day" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await confirmAssignment(s.coordinator, second.assignment.id, { overrideReason: "Short day" });
    const saved = await db.crewAssignment.findUniqueOrThrow({
      where: { id: second.assignment.id },
    });
    expect(saved).toMatchObject({
      status: "CONFIRMED",
      overrideReason: "Short day",
      overrideById: s.coordinator.id,
    });

    // Time off is a clash too.
    await addUnavailability(s.coordinator, s.freelancer.id, { startDate: "2099-04-01" });
    const third = await proposeAssignment(s.pm, s.project.id, {
      crewMemberId: s.freelancer.id,
      role: "Rigger",
      startDate: "2099-04-01",
    });
    expect(third.clashes.map((c) => c.kind)).toEqual(["time_off"]);
    const crew = await projectCrew(s.pm, s.project.id);
    expect(crew.assignments.find((a) => a.id === third.assignment.id)!.clashes).toHaveLength(1);

    const free = await crewAvailability(s.pm, { from: day("2099-03-10"), to: day("2099-03-10") });
    expect(free.find((m) => m.id === s.freelancer.id)).toMatchObject({ free: false });
  });

  it("books staff without rates or project cost, and keeps them from approving their own work", async () => {
    const s = await setup();
    const staff = await createCrewMember(s.coordinator, {
      name: s.pm.name,
      kind: "EMPLOYEE",
      userId: s.pm.id,
    });
    const { assignment } = await proposeAssignment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      crewMemberId: staff.id,
    });
    expect(assignment.dayRateMinor).toBeNull();
    await confirmAssignment(s.pm, assignment.id);
    expect((await s.budget()).committedMinor).toBe(0n);
    await recordWork(s.pm, assignment.id, { date: "2099-03-10" });
    await expect(approveWork(s.pm, assignment.id)).rejects.toBeInstanceOf(ForbiddenError);
    await approveWork(s.owner, assignment.id);
    expect(await settleableWork(s.finance, s.entity.id)).toEqual([]);
  });

  it("releases settled work when the bill is discarded, and substitutes crew", async () => {
    const s = await setup();
    const { assignment } = await proposeAssignment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      crewMemberId: s.freelancer.id,
    });
    await confirmAssignment(s.pm, assignment.id);
    const w = await recordWork(s.pm, assignment.id, { date: "2099-03-10" });
    await removeWork(s.pm, w.id);
    await recordWork(s.pm, assignment.id, { date: "2099-03-10" });
    await approveWork(s.pm, assignment.id);
    const { bill } = await createSettlement(s.finance, s.entity.id, s.freelancer.id);
    await discardBill(s.finance, bill.id);
    expect((await settleableWork(s.finance, s.entity.id))[0]!.totalMinor).toBe(3_000_00n);

    // Ravi is replaced for the day not yet worked.
    const sara = await createCrewMember(s.coordinator, { name: "Sara", kind: "FREELANCER" });
    await addCrewRate(s.coordinator, sara.id, {
      type: "DAY",
      currency: "INR",
      amount: "3500",
      validFrom: "2026-01-01",
    });
    const { assignment: replacement } = await substituteAssignment(s.pm, assignment.id, {
      crewMemberId: sara.id,
      reason: "Ravi is unwell",
    });
    expect(replacement).toMatchObject({
      replacesId: assignment.id,
      startDate: day("2099-03-11"),
      endDate: day("2099-03-11"),
      dayRateMinor: 3_500_00n,
      status: "PROPOSED",
    });
    const old = await db.crewAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(old).toMatchObject({
      status: "CANCELLED",
      endedReason: "Replaced by Sara: Ravi is unwell",
    });
    // Ravi's commitment was voided with nothing billed on it.
    expect((await s.budget()).committedMinor).toBe(0n);
    await expect(
      endAssignment(s.pm, assignment.id, "DECLINED", { reason: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const audit = await db.auditEvent.findMany({
      where: { targetId: s.project.id, action: { startsWith: "crew_" } },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "crew_assignment.proposed",
      "crew_assignment.confirmed",
      "crew_work.recorded",
      "crew_work.removed",
      "crew_work.recorded",
      "crew_work.approved",
      "crew_assignment.cancelled",
      "crew_assignment.proposed",
    ]);
  });

  it("keeps rates from people who can't see costs, and booking from people who can't book", async () => {
    const s = await setup();
    const { assignment } = await proposeAssignment(s.pm, s.project.id, {
      requirementId: s.requirement.id,
      crewMemberId: s.freelancer.id,
    });
    const viewer = await makeActor("viewer");
    const seen = await projectCrew(viewer, s.project.id);
    expect(seen.assignments[0]!.dayRateMinor).toBeNull();
    await expect(confirmAssignment(viewer, assignment.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      proposeAssignment(viewer, s.project.id, {
        crewMemberId: s.freelancer.id,
        role: "x",
        startDate: "2099-03-10",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
