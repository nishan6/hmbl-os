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

/** What the quote page says after a workflow step (`?done=`). */
export const QUOTE_DONE: Record<string, string> = {
  submit: "Submitted for approval",
  approve: "Approved. It can be issued now",
  reject: "Sent back to draft",
  issue: "Issued. This version is now locked",
  withdraw: "Withdrawn",
};
