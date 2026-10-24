-- Documents across records (docs/documents.md). Project documents become
-- `documents`, attached to any record by type and id. Existing rows are kept.

-- CreateEnum
CREATE TYPE "DocumentRecordType" AS ENUM ('PROJECT', 'CLIENT', 'QUOTE', 'VENDOR', 'PURCHASE_ORDER', 'VENDOR_BILL', 'SALES_INVOICE', 'CREW_MEMBER', 'EQUIPMENT_ITEM', 'TRAVEL_REQUEST', 'SHIPMENT');

-- CreateEnum
CREATE TYPE "DocumentAccess" AS ENUM ('STANDARD', 'RESTRICTED');

-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'QUOTATION';
ALTER TYPE "DocumentCategory" ADD VALUE 'SIGNED_AGREEMENT';
ALTER TYPE "DocumentCategory" ADD VALUE 'VENDOR_PO';
ALTER TYPE "DocumentCategory" ADD VALUE 'INVOICE';
ALTER TYPE "DocumentCategory" ADD VALUE 'RECEIPT';
ALTER TYPE "DocumentCategory" ADD VALUE 'EXPENSE_EVIDENCE';
ALTER TYPE "DocumentCategory" ADD VALUE 'EQUIPMENT_CHECKLIST';
ALTER TYPE "DocumentCategory" ADD VALUE 'COMPLIANCE';
ALTER TYPE "DocumentCategory" ADD VALUE 'IDENTITY';

-- The old append-only trigger would refuse the backfill below.
DROP TRIGGER project_documents_append_only ON "project_documents";
DROP FUNCTION project_documents_append_only();

-- RenameTable and its constraints and indexes
ALTER TABLE "project_documents" RENAME TO "documents";
ALTER TABLE "documents" RENAME CONSTRAINT "project_documents_pkey" TO "documents_pkey";
ALTER TABLE "documents" RENAME CONSTRAINT "project_documents_projectId_fkey" TO "documents_projectId_fkey";
ALTER TABLE "documents" RENAME CONSTRAINT "project_documents_previousVersionId_fkey" TO "documents_previousVersionId_fkey";
ALTER TABLE "documents" RENAME CONSTRAINT "project_documents_uploadedById_fkey" TO "documents_uploadedById_fkey";
ALTER TABLE "documents" RENAME CONSTRAINT "project_documents_check" TO "documents_check";
ALTER INDEX "project_documents_storageKey_key" RENAME TO "documents_storageKey_key";
ALTER INDEX "project_documents_previousVersionId_key" RENAME TO "documents_previousVersionId_key";
ALTER INDEX "project_documents_projectId_category_idx" RENAME TO "documents_projectId_category_idx";

-- AlterTable
ALTER TABLE "documents"
  ADD COLUMN "recordType" "DocumentRecordType",
  ADD COLUMN "recordId" UUID,
  ADD COLUMN "legalEntityId" UUID,
  ADD COLUMN "access" "DocumentAccess" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "retainUntil" DATE,
  ALTER COLUMN "projectId" DROP NOT NULL;

UPDATE "documents" d
SET "recordType" = 'PROJECT', "recordId" = d."projectId", "legalEntityId" = p."legalEntityId"
FROM "projects" p
WHERE p."id" = d."projectId";

ALTER TABLE "documents"
  ALTER COLUMN "recordType" SET NOT NULL,
  ALTER COLUMN "recordId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "documents_recordType_recordId_idx" ON "documents"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "documents_legalEntityId_uploadedAt_idx" ON "documents"("legalEntityId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A project document's record is its project.
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_record_check"
  CHECK ("recordType" <> 'PROJECT' OR "recordId" = "projectId");

-- A document's file and facts never change, and documents are never
-- deleted. Only superseding and archiving are recorded, each once.
CREATE OR REPLACE FUNCTION documents_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'documents can''t be deleted; archive them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'supersededAt' - 'archivedAt' - 'archiveReason')
     <> (to_jsonb(OLD) - 'supersededAt' - 'archivedAt' - 'archiveReason')
     OR (OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt")
     OR (OLD."archivedAt" IS NOT NULL AND (NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
         OR NEW."archiveReason" IS DISTINCT FROM OLD."archiveReason")) THEN
    RAISE EXCEPTION 'documents can''t be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_append_only
  BEFORE UPDATE OR DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION documents_append_only();
