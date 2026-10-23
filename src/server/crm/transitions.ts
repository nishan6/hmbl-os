/**
 * Pipeline transition rules, kept pure so they can be tested on their own.
 *
 * - Open stages move freely forwards and backwards.
 * - Lost, on hold and cancelled need a reason. Won takes an optional one.
 * - Leaving a closed stage (won, lost, cancelled) reopens the opportunity and
 *   needs a reason.
 * - Archived stages can't be entered.
 */
export type StageLike = {
  id: string;
  kind: "OPEN" | "WON" | "LOST" | "ON_HOLD" | "CANCELLED";
  status: "ACTIVE" | "ARCHIVED";
};

export const CLOSED_KINDS = new Set(["WON", "LOST", "CANCELLED"]);
const NEEDS_REASON = new Set(["LOST", "ON_HOLD", "CANCELLED"]);

export type TransitionCheck =
  | { ok: true; closes: boolean; reopens: boolean }
  | { ok: false; field: "stageId" | "reason"; message: string };

export function checkTransition(
  from: StageLike,
  to: StageLike,
  reason: string | null | undefined,
): TransitionCheck {
  if (to.status !== "ACTIVE") {
    return { ok: false, field: "stageId", message: "That stage is archived" };
  }
  if (from.id === to.id) {
    return { ok: false, field: "stageId", message: "The opportunity is already in this stage" };
  }
  const reopens = CLOSED_KINDS.has(from.kind) && !CLOSED_KINDS.has(to.kind);
  const hasReason = Boolean(reason?.trim());
  if (NEEDS_REASON.has(to.kind) && !hasReason) {
    return { ok: false, field: "reason", message: "Give a reason for this outcome" };
  }
  if (reopens && !hasReason) {
    return { ok: false, field: "reason", message: "Give a reason for reopening" };
  }
  return { ok: true, closes: CLOSED_KINDS.has(to.kind), reopens };
}
