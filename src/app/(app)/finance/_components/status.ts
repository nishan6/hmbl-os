import type { StatusKey } from "@/components/ui/status";
import type { InvoiceStatus, JournalStatus, ReceiptStatus } from "@/generated/prisma/enums";
import type { PaymentState } from "@/lib/invoice";

export const JOURNAL_STATUS: Record<JournalStatus, StatusKey> = {
  DRAFT: "draft",
  POSTED: "posted",
  DISCARDED: "voided",
};

export const DOCUMENT_STATUS: Record<InvoiceStatus, StatusKey> = {
  DRAFT: "draft",
  ISSUED: "issued",
  DISCARDED: "voided",
};

export const PAYMENT_STATUS: Record<PaymentState, StatusKey> = {
  UNPAID: "due",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  OVERDUE: "overdue",
  CREDITED: "credited",
};

export const RECEIPT_STATUS: Record<ReceiptStatus, StatusKey> = {
  POSTED: "posted",
  VOIDED: "voided",
};
