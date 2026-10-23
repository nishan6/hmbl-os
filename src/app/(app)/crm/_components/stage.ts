import type { StatusKey } from "@/components/ui/status";

/** The status badge for a pipeline stage kind. */
export const STAGE_STATUS: Record<string, StatusKey> = {
  OPEN: "open",
  WON: "won",
  LOST: "lost",
  ON_HOLD: "on_hold",
  CANCELLED: "cancelled",
};
