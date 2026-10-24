import type { StatusKey } from "@/components/ui/status";
import type { CrewAssignmentStatus, EquipmentBookingStatus } from "@/generated/prisma/enums";
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

export const CHANGE_ORDER_STATUS: Record<"DRAFT" | "APPROVED" | "WITHDRAWN", StatusKey> = {
  DRAFT: "draft",
  APPROVED: "approved",
  WITHDRAWN: "withdrawn",
};

export const ASSIGNMENT_STATUS: Record<CrewAssignmentStatus, StatusKey> = {
  PROPOSED: "proposed",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
  CANCELLED: "cancelled",
};

export const BOOKING_STATUS: Record<EquipmentBookingStatus, StatusKey> = {
  RESERVED: "reserved",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};
