import type { Permission } from "@/server/permissions/catalog";

/*
 * The project lifecycle (spec §10), the suggested default:
 *
 *   Draft → Commercial review → Approved → Planning → Ready → In progress
 *         → Completed → Financial close → Closed
 *
 * plus On hold and Cancelled from any open status. Projects made from an
 * accepted quote start at Approved; projects created directly start as Draft
 * and need the Director's approval, which fixes their budget baseline.
 *
 * The rules are pure so they can be tested and shown in the UI before the
 * server checks them again. LABELLED DEFAULT (docs/decisions.md).
 */

export const PROJECT_STATUSES = {
  DRAFT: "Draft",
  COMMERCIAL_REVIEW: "Commercial review",
  APPROVED: "Approved",
  PLANNING: "Planning",
  READY: "Ready for execution",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  FINANCIAL_CLOSE: "Financial close",
  CLOSED: "Closed",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
} as const;

export type ProjectStatus = keyof typeof PROJECT_STATUSES;

/** The main path, in order. On hold and Cancelled sit outside it. */
export const PROJECT_PATH = [
  "DRAFT",
  "COMMERCIAL_REVIEW",
  "APPROVED",
  "PLANNING",
  "READY",
  "IN_PROGRESS",
  "COMPLETED",
  "FINANCIAL_CLOSE",
  "CLOSED",
] as const satisfies ProjectStatus[];

const rank = (s: ProjectStatus) => (PROJECT_PATH as readonly string[]).indexOf(s);

/** Statuses before approval: the budget can still be drafted. */
export function isPreApproval(status: ProjectStatus) {
  return status === "DRAFT" || status === "COMMERCIAL_REVIEW";
}

/** Work can be planned and changed: approved and not yet in financial close. */
export function isOpen(status: ProjectStatus) {
  return rank(status) >= 0 && rank(status) <= rank("COMPLETED");
}

/** Nothing about the project may change any more. */
export function isLocked(status: ProjectStatus) {
  return status === "CLOSED" || status === "CANCELLED";
}

export type Move =
  | {
      ok: true;
      permission: Permission;
      needsReason: boolean;
      /** Closing a project: callers check closeout before allowing it. */
      closes: boolean;
    }
  | { ok: false; message: string };

const allow = (permission: Permission, needsReason = false, closes = false): Move => ({
  ok: true,
  permission,
  needsReason,
  closes,
});
const refuse = (message: string): Move => ({ ok: false, message });

/**
 * Can a project move from `from` to `to`? Says which permission the move
 * needs and whether a reason is required. `resumeStatus` is where a project
 * on hold or cancelled returns to.
 */
export function checkMove(
  from: ProjectStatus,
  to: ProjectStatus,
  resumeStatus: ProjectStatus | null = null,
): Move {
  if (from === to) return refuse(`The project is already ${PROJECT_STATUSES[to].toLowerCase()}.`);

  if (from === "ON_HOLD") {
    if (to === "CANCELLED") return allow("projects.approve", true);
    if (to === resumeStatus) return allow("projects.edit");
    return refuse(
      `Resume the project first. It goes back to ${
        resumeStatus ? PROJECT_STATUSES[resumeStatus].toLowerCase() : "where it was"
      }.`,
    );
  }
  if (from === "CANCELLED") {
    if (to === resumeStatus) return allow("projects.approve", true);
    return refuse("A cancelled project can only be reopened where it was cancelled.");
  }

  if (to === "ON_HOLD") {
    if (rank(from) > rank("COMPLETED"))
      return refuse("A project in financial close can't be put on hold.");
    return allow("projects.edit", true);
  }
  if (to === "CANCELLED") {
    if (rank(from) > rank("COMPLETED"))
      return refuse("A project in financial close can't be cancelled.");
    // A draft nobody approved yet can be dropped by whoever runs it.
    return allow(isPreApproval(from) ? "projects.edit" : "projects.approve", true);
  }

  const step = rank(to) - rank(from);
  if (step > 0) {
    if (from === "DRAFT" && to === "COMMERCIAL_REVIEW") return allow("projects.submit");
    if (isPreApproval(from) && to === "APPROVED") return allow("projects.approve");
    if (isPreApproval(from)) return refuse("The project needs approval first.");
    if (to === "FINANCIAL_CLOSE" && from !== "COMPLETED") {
      return refuse("Mark the project completed before financial close.");
    }
    if (to === "CLOSED") {
      if (from !== "FINANCIAL_CLOSE") return refuse("Closing comes after financial close.");
      return allow("projects.approve", false, true);
    }
    return allow("projects.edit");
  }

  // Backwards.
  if (from === "COMMERCIAL_REVIEW" && to === "DRAFT") return allow("projects.reject", true);
  if (!isPreApproval(from) && isPreApproval(to)) {
    return refuse("An approved project can't go back to draft. Use a change order instead.");
  }
  if (from === "CLOSED") {
    if (to !== "FINANCIAL_CLOSE")
      return refuse("A closed project can only reopen to financial close.");
    return allow("projects.approve", true);
  }
  return allow("projects.edit", true);
}

/** Where a project returns to after a move to `to`: kept while on hold or cancelled. */
export function resumeStatusAfter(
  from: ProjectStatus,
  to: ProjectStatus,
  current: ProjectStatus | null,
): ProjectStatus | null {
  if (to !== "ON_HOLD" && to !== "CANCELLED") return null;
  return from === "ON_HOLD" || from === "CANCELLED" ? current : from;
}

/** Every status the project could move to from here, for the UI to offer. */
export function nextStatuses(from: ProjectStatus, resumeStatus: ProjectStatus | null) {
  return (Object.keys(PROJECT_STATUSES) as ProjectStatus[]).filter(
    (to) => checkMove(from, to, resumeStatus).ok,
  );
}
