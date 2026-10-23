-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('INTRA_STATE', 'INTER_STATE', 'EXPORT', 'NON_GST');

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "clientId" UUID NOT NULL,
    "projectId" UUID,
    "milestoneId" UUID,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fxRate" DECIMAL(18,8),
    "fxNote" TEXT,
    "supplyType" "SupplyType" NOT NULL,
    "placeOfSupplyCode" TEXT,
    "placeOfSupplyCountry" CHAR(2) NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientGstin" TEXT,
    "clientAddress" TEXT,
    "entityGstin" TEXT,
    "clientPoNumber" TEXT,
    "notes" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "cgstMinor" BIGINT NOT NULL DEFAULT 0,
    "sgstMinor" BIGINT NOT NULL DEFAULT 0,
    "igstMinor" BIGINT NOT NULL DEFAULT 0,
    "otherTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "baseTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "revenueDeferred" BOOLEAN NOT NULL DEFAULT false,
    "revenueRecognisedAt" TIMESTAMP(3),
    "journalId" UUID,
    "recognitionJournalId" UUID,
    "issuedAt" TIMESTAMP(3),
    "issuedById" UUID,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "sacCode" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "taxRateId" UUID,
    "taxCode" TEXT,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "cgstMinor" BIGINT NOT NULL DEFAULT 0,
    "sgstMinor" BIGINT NOT NULL DEFAULT 0,
    "igstMinor" BIGINT NOT NULL DEFAULT 0,
    "otherTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "revenueAccountId" UUID NOT NULL,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "cgstMinor" BIGINT NOT NULL DEFAULT 0,
    "sgstMinor" BIGINT NOT NULL DEFAULT 0,
    "igstMinor" BIGINT NOT NULL DEFAULT 0,
    "otherTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "baseTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "journalId" UUID,
    "issuedAt" TIMESTAMP(3),
    "issuedById" UUID,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" UUID NOT NULL,
    "creditNoteId" UUID NOT NULL,
    "invoiceLineId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "cgstMinor" BIGINT NOT NULL DEFAULT 0,
    "sgstMinor" BIGINT NOT NULL DEFAULT 0,
    "igstMinor" BIGINT NOT NULL DEFAULT 0,
    "otherTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_journalId_key" ON "sales_invoices"("journalId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_recognitionJournalId_key" ON "sales_invoices"("recognitionJournalId");

-- CreateIndex
CREATE INDEX "sales_invoices_clientId_idx" ON "sales_invoices"("clientId");

-- CreateIndex
CREATE INDEX "sales_invoices_projectId_idx" ON "sales_invoices"("projectId");

-- CreateIndex
CREATE INDEX "sales_invoices_legalEntityId_status_dueDate_idx" ON "sales_invoices"("legalEntityId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_legalEntityId_number_key" ON "sales_invoices"("legalEntityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_lines_invoiceId_position_key" ON "sales_invoice_lines"("invoiceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_journalId_key" ON "credit_notes"("journalId");

-- CreateIndex
CREATE INDEX "credit_notes_invoiceId_idx" ON "credit_notes"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_legalEntityId_number_key" ON "credit_notes"("legalEntityId", "number");

-- CreateIndex
CREATE INDEX "credit_note_lines_invoiceLineId_idx" ON "credit_note_lines"("invoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_lines_creditNoteId_position_key" ON "credit_note_lines"("creditNoteId", "position");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "project_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "sales_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Invoice invariants (docs/invoicing.md) ─────────────────────────────────

ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_issued_check" CHECK (
  "status" <> 'ISSUED' OR ("number" IS NOT NULL AND "journalId" IS NOT NULL AND "issuedAt" IS NOT NULL)
);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_check" CHECK (
  "status" <> 'ISSUED' OR ("number" IS NOT NULL AND "journalId" IS NOT NULL AND "issuedAt" IS NOT NULL)
);
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_amounts_check" CHECK (
  "amountMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" = "amountMinor" + "taxMinor"
);
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_amounts_check" CHECK (
  "amountMinor" > 0 AND "taxMinor" >= 0 AND "totalMinor" = "amountMinor" + "taxMinor"
);

-- An issued or discarded document never changes and is never deleted. The
-- only later change is recognising deferred revenue on an invoice, once.
CREATE OR REPLACE FUNCTION finance_document_frozen() RETURNS trigger AS $$
DECLARE
  allowed text[] := ARRAY['updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION '% % can''t be deleted', TG_TABLE_NAME, OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'sales_invoices' AND OLD."revenueRecognisedAt" IS NULL THEN
    allowed := allowed || ARRAY['revenueRecognisedAt', 'recognitionJournalId'];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION '% % is % and can''t be changed', TG_TABLE_NAME, OLD.id, lower(OLD.status::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_invoice_frozen
  BEFORE UPDATE OR DELETE ON "sales_invoices"
  FOR EACH ROW EXECUTE FUNCTION finance_document_frozen();
CREATE TRIGGER credit_note_frozen
  BEFORE UPDATE OR DELETE ON "credit_notes"
  FOR EACH ROW EXECUTE FUNCTION finance_document_frozen();

-- Lines change only while their document is a draft.
CREATE OR REPLACE FUNCTION finance_document_line_frozen() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'sales_invoice_lines' THEN
    SELECT status::text INTO parent_status FROM sales_invoices
     WHERE id = COALESCE(NEW."invoiceId", OLD."invoiceId");
  ELSE
    SELECT status::text INTO parent_status FROM credit_notes
     WHERE id = COALESCE(NEW."creditNoteId", OLD."creditNoteId");
  END IF;
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'lines of a % document can''t be changed', lower(parent_status)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_invoice_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "sales_invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION finance_document_line_frozen();
CREATE TRIGGER credit_note_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "credit_note_lines"
  FOR EACH ROW EXECUTE FUNCTION finance_document_line_frozen();
