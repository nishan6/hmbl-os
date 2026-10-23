import type { StatusKey } from "@/components/ui/status";
import type { ProjectStatus } from "@/server/projects/lifecycle";

export const PROJECT_STATUS: Record<ProjectStatus, StatusKey> = {
  DRAFT: "draft",
  COMMERCIAL_REVIEW: "pending_review",
  APPROVED: "approved",
  PLANNING: "planning",
  READY: "ready",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FINANCIAL_CLOSE: "financial_close",
  CLOSED: "closed",
  ON_HOLD: "on_hold",
  CANCELLED: "cancelled",
};
