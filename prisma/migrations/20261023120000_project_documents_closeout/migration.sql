-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('CONTRACT', 'CLIENT_PO', 'TECHNICAL', 'CALL_SHEET', 'TRAVEL', 'DELIVERABLE', 'CLOSEOUT_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "CloseoutItemKey" AS ENUM ('INVOICES_ISSUED', 'PAYMENTS_COLLECTED', 'VENDOR_BILLS_RECEIVED', 'CREW_SETTLED', 'EQUIPMENT_RETURNED', 'EXPENSES_RECONCILED', 'FINAL_REPORT');

-- CreateTable
CREATE TABLE "project_documents" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" UUID,
    "supersededAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "uploadedById" UUID NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_closeout_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" "CloseoutItemKey" NOT NULL,
    "doneAt" TIMESTAMP(3),
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "updatedById" UUID,
    "updatedByLabel" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_closeout_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_documents_storageKey_key" ON "project_documents"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_documents_previousVersionId_key" ON "project_documents"("previousVersionId");

-- CreateIndex
CREATE INDEX "project_documents_projectId_category_idx" ON "project_documents"("projectId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "project_closeout_items_projectId_key_key" ON "project_closeout_items"("projectId", "key");

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "project_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_closeout_items" ADD CONSTRAINT "project_closeout_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: docs/documents.md and docs/closeout.md.
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_check"
  CHECK ("sizeBytes" > 0 AND "version" >= 1 AND ("archivedAt" IS NULL OR "archiveReason" IS NOT NULL));
ALTER TABLE "project_closeout_items" ADD CONSTRAINT "project_closeout_items_check"
  CHECK (NOT ("notApplicable" AND "doneAt" IS NOT NULL) AND (NOT "notApplicable" OR "note" IS NOT NULL));

-- A document's file and facts never change, and documents are never
-- deleted. Only superseding and archiving are recorded, each once.
CREATE OR REPLACE FUNCTION project_documents_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project documents can''t be deleted; archive them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'supersededAt' - 'archivedAt' - 'archiveReason')
     <> (to_jsonb(OLD) - 'supersededAt' - 'archivedAt' - 'archiveReason')
     OR (OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt")
     OR (OLD."archivedAt" IS NOT NULL AND (NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
         OR NEW."archiveReason" IS DISTINCT FROM OLD."archiveReason")) THEN
    RAISE EXCEPTION 'project documents can''t be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_documents_append_only
  BEFORE UPDATE OR DELETE ON "project_documents"
  FOR EACH ROW EXECUTE FUNCTION project_documents_append_only();
