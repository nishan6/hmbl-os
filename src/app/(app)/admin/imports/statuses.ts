import type { StatusKey } from "@/components/ui/status";
import type { ImportOutcome, ImportRowStatus, ImportStatus } from "@/generated/prisma/enums";

/** Status words for batches and rows, each with the shared icon and tone. */
export const BATCH_STATUS: Record<ImportStatus, { status: StatusKey; label: string }> = {
  STAGED: { status: "draft", label: "Not imported yet" },
  COMMITTING: { status: "in_progress", label: "Importing" },
  COMMITTED: { status: "completed", label: "Imported" },
  DISCARDED: { status: "cancelled", label: "Discarded" },
};

export const ROW_STATUS: Record<ImportRowStatus, { status: StatusKey; label: string }> = {
  VALID: { status: "ready", label: "Ready" },
  INVALID: { status: "issue", label: "Has problems" },
  DUPLICATE: { status: "conflict", label: "Possible duplicate" },
};

export const ROW_OUTCOME: Record<ImportOutcome, { status: StatusKey; label: string }> = {
  CREATED: { status: "completed", label: "Created" },
  UPDATED: { status: "completed", label: "Updated" },
  SKIPPED: { status: "cancelled", label: "Skipped" },
  REJECTED: { status: "rejected", label: "Not imported" },
  FAILED: { status: "failed", label: "Failed" },
};

export const DECISION_LABEL = {
  CREATE: "Create a new record",
  UPDATE: "Update the existing record",
  SKIP: "Skip this row",
} as const;
