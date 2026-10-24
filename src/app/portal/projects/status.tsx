import { CLIENT_PROJECT_STATUS } from "@/server/portal/client";
import { StatusBadge, type StatusKey } from "@/components/ui/status";

const KEY: Record<string, StatusKey> = {
  DRAFT: "pending_review",
  COMMERCIAL_REVIEW: "pending_review",
  APPROVED: "confirmed",
  PLANNING: "planning",
  READY: "ready",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FINANCIAL_CLOSE: "completed",
  CLOSED: "completed",
  ON_HOLD: "on_hold",
  CANCELLED: "cancelled",
};

/** A project's status in the words a client reads. */
export function ProjectStatus({ status }: { status: string }) {
  return (
    <StatusBadge
      status={KEY[status] ?? "in_progress"}
      label={CLIENT_PROJECT_STATUS[status] ?? "In progress"}
    />
  );
}
