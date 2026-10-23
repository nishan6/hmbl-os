import type { StatusKey } from "@/components/ui/status";

export const QUOTE_STATUS: Record<string, StatusKey> = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  ISSUED: "issued",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  SUPERSEDED: "superseded",
  WITHDRAWN: "withdrawn",
};
