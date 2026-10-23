import type { StatusKey } from "@/components/ui/status";
import type { JournalStatus } from "@/generated/prisma/enums";

export const JOURNAL_STATUS: Record<JournalStatus, StatusKey> = {
  DRAFT: "draft",
  POSTED: "posted",
  DISCARDED: "voided",
};
