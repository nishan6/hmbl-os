import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { endInTx, lockAssignment } from "@/server/crew/assignments";
import { billSettlements } from "@/server/finance/bills";
import { assertChangeable, lockProject } from "@/server/projects/projects";
import { requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { authorizePortal, portalCaller, type PortalActor } from "./session";

/*
 * What a freelancer's portal account sees and does (docs/vendor-portal.md):
 * their own bookings, call details and pay only. Never other crew, project
 * budgets or finances, or employee records.
 */

const uuid = z.uuid();
const known = (id: string) => {
  if (!uuid.safeParse(id).success) throw new NotFoundError();
  return id;
};

function memberOf(actor: PortalActor, permission: string) {
  authorizePortal(actor, "FREELANCER", permission);
  return actor.crewMemberId!;
}

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

// ─── Bookings ────────────────────────────────────────────────────────────────

const bookingSelect = {
  id: true,
  role: true,
  startDate: true,
  endDate: true,
  status: true,
  currency: true,
  dayRateMinor: true,
  halfDayRateMinor: true,
  overtimeRateMinor: true,
  callTime: true,
  reportTo: true,
  project: { select: { number: true, name: true, venue: true, legalEntityId: true } },
  portalResponse: { select: { answer: true, note: true, createdAt: true } },
} as const;

export async function listMyBookings(actor: PortalActor) {
  const crewMemberId = memberOf(actor, "work.view");
  const rows = await db.crewAssignment.findMany({
    where: { crewMemberId },
    orderBy: [{ startDate: "desc" }],
    select: bookingSelect,
  });
  return rows.map(({ project: { legalEntityId: _e, ...project }, ...b }) => {
    void _e;
    return { ...b, project };
  });
}

/** One of their bookings, with the days they have recorded on it. */
export async function getMyBooking(actor: PortalActor, assignmentId: string) {
  const crewMemberId = memberOf(actor, "work.view");
  const booking = await db.crewAssignment.findFirst({
    where: { id: known(assignmentId), crewMemberId },
    select: {
      ...bookingSelect,
      workRecords: {
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          day: true,
          overtimeMinutes: true,
          expensesMinor: true,
          notes: true,
          approvedAt: true,
        },
      },
    },
  });
  if (!booking) throw new NotFoundError();
  const {
    project: { legalEntityId: _e, ...project },
    ...rest
  } = booking;
  void _e;
  return {
    ...rest,
    project,
    canAnswer: booking.status === "PROPOSED" && !booking.portalResponse,
    canRecord: booking.status === "CONFIRMED",
  };
}

const answerInput = z.discriminatedUnion("answer", [
  z.object({ answer: z.literal("CONFIRMED"), note: optionalText(1000) }),
  z.object({ answer: z.literal("DECLINED"), note: requiredText(500) }),
]);
export type BookingAnswerInput = z.input<typeof answerInput>;

/**
 * The freelancer says whether they can do a proposed booking. A yes is passed
 * to the crew coordinator, who confirms it (clashes and budget are theirs to
 * check); a no ends the booking as declined at once.
 */
export async function answerBooking(
  actor: PortalActor,
  assignmentId: string,
  raw: BookingAnswerInput,
) {
  const crewMemberId = memberOf(actor, "work.confirm");
  const input = parseInput(answerInput, raw);
  const booking = await db.crewAssignment.findFirst({
    where: { id: known(assignmentId), crewMemberId },
    select: { id: true, project: { select: { id: true, legalEntityId: true } } },
  });
  if (!booking) throw new NotFoundError();
  const caller = portalCaller(actor);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, booking.project.id));
    const a = await lockAssignment(tx, booking.id);
    if (a.status !== "PROPOSED") throw new ConflictError("This booking can't be answered now.");
    if (await tx.crewAssignmentResponse.findUnique({ where: { assignmentId: a.id } })) {
      throw new ConflictError("You have already answered this booking.");
    }
    const response = await tx.crewAssignmentResponse.create({
      data: {
        assignmentId: a.id,
        accountId: actor.accountId,
        answer: input.answer,
        note: input.note ?? null,
      },
    });
    if (input.answer === "DECLINED") {
      await endInTx(tx, caller, booking.project, a.id, "DECLINED", input.note);
    } else {
      await recordAudit(tx, caller, {
        action: "crew_assignment.freelancer_available",
        targetType: "project",
        targetId: booking.project.id,
        legalEntityId: booking.project.legalEntityId,
        metadata: { assignmentId: a.id, note: input.note ?? null, via: "portal" },
      });
    }
    return response;
  });
}

// ─── Timesheets ──────────────────────────────────────────────────────────────

const workInput = z.object({
  date: requiredDate,
  day: z.enum(["FULL", "HALF"]).default("FULL"),
  overtimeMinutes: z.number().int().min(0).max(1440).default(0),
  expenses: z.string().nullish(),
  notes: optionalText(500),
});
export type TimesheetInput = z.input<typeof workInput>;

/**
 * Records or corrects a day the freelancer worked on a confirmed booking,
 * until the project approves it. The project manager is told.
 */
export async function submitTimesheetDay(
  actor: PortalActor,
  assignmentId: string,
  raw: TimesheetInput,
) {
  const crewMemberId = memberOf(actor, "timesheets.submit");
  const booking = await db.crewAssignment.findFirst({
    where: { id: known(assignmentId), crewMemberId },
    select: { id: true, currency: true, project: { select: { id: true, legalEntityId: true } } },
  });
  if (!booking) throw new NotFoundError();
  const input = parseInput(workInput, raw);
  const date = input.date!;
  let expensesMinor = 0n;
  if (input.expenses?.trim()) {
    const parsed = parseMoneyToMinor(input.expenses, booking.currency);
    if (parsed === null || parsed < 0n) throw invalid("expenses", "Enter an amount, e.g. 450");
    expensesMinor = parsed;
  }
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, booking.project.id));
    const a = await lockAssignment(tx, booking.id);
    if (a.status !== "CONFIRMED") throw new ConflictError("Record days on confirmed bookings.");
    if (date < a.startDate || date > a.endDate)
      throw invalid("date", "Choose a day of the booking");
    const existing = await tx.crewWorkRecord.findUnique({
      where: { assignmentId_date: { assignmentId: a.id, date } },
    });
    if (existing?.approvedAt) throw new ConflictError("That day is approved and can't change.");
    const data = {
      day: input.day,
      overtimeMinutes: input.overtimeMinutes,
      expensesMinor,
      notes: input.notes,
    };
    const record = existing
      ? await tx.crewWorkRecord.update({ where: { id: existing.id }, data })
      : await tx.crewWorkRecord.create({
          data: { ...data, assignmentId: a.id, date, createdById: actor.id },
        });
    await recordAudit(tx, portalCaller(actor), {
      action: existing ? "crew_work.updated" : "crew_work.recorded",
      targetType: "project",
      targetId: booking.project.id,
      legalEntityId: booking.project.legalEntityId,
      metadata: {
        assignmentId: a.id,
        workRecordId: record.id,
        date: date.toISOString().slice(0, 10),
        via: "portal",
      },
    });
    return record;
  });
}

// ─── Settlements ─────────────────────────────────────────────────────────────

/** What HMBL has settled for them, and whether it has been paid. */
export async function listMySettlements(actor: PortalActor) {
  const crewMemberId = memberOf(actor, "settlements.view");
  const settlements = await db.crewSettlement.findMany({
    where: { crewMemberId, releasedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      currency: true,
      totalMinor: true,
      createdAt: true,
      bill: { select: { id: true, status: true, payableMinor: true, tdsMinor: true } },
      _count: { select: { workRecords: true } },
    },
  });
  const paid = await billSettlements(
    db,
    settlements.filter((s) => s.bill.status === "APPROVED").map((s) => s.bill.id),
  );
  const approvedUnsettled = await db.crewWorkRecord.count({
    where: { assignment: { crewMemberId }, approvedAt: { not: null }, settlementId: null },
  });
  return {
    approvedUnsettled,
    settlements: settlements.map(({ bill, _count, ...s }) => {
      const paidMinor = paid.get(bill.id)?.paidMinor ?? 0n;
      return {
        ...s,
        days: _count.workRecords,
        tdsMinor: bill.tdsMinor,
        payableMinor: bill.payableMinor,
        paidMinor,
        state:
          bill.status !== "APPROVED"
            ? ("checking" as const)
            : paidMinor >= bill.payableMinor
              ? ("paid" as const)
              : paidMinor > 0n
                ? ("partially_paid" as const)
                : ("approved" as const),
      };
    }),
  };
}
