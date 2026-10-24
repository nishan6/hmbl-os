-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('PROFORMA', 'COMMERCIAL', 'TAX');

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'TAX',
ADD COLUMN     "sourceInvoiceId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_source_kind_key" ON "sales_invoices"("sourceInvoiceId", "kind") WHERE (status <> 'DISCARDED');

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sourceInvoiceId_fkey" FOREIGN KEY ("sourceInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Only a tax invoice posts to the ledger; proforma and commercial invoices never do.
ALTER TABLE "sales_invoices" DROP CONSTRAINT "sales_invoices_issued_check";
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_issued_check" CHECK (
  "status" <> 'ISSUED' OR ("number" IS NOT NULL AND "issuedAt" IS NOT NULL
    AND ("journalId" IS NOT NULL) = ("kind" = 'TAX'))
);
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_kind_check" CHECK (
  "kind" = 'TAX' OR ("journalId" IS NULL AND "recognitionJournalId" IS NULL AND NOT "revenueDeferred")
);

-- Receipts are allocated to, and credit notes raised against, tax invoices only.
CREATE OR REPLACE FUNCTION tax_invoice_only() RETURNS trigger AS $$
DECLARE
  invoice_kind text;
BEGIN
  SELECT kind::text INTO invoice_kind FROM sales_invoices WHERE id = NEW."invoiceId";
  IF invoice_kind IS DISTINCT FROM 'TAX' THEN
    RAISE EXCEPTION '% must point at a tax invoice, not a % invoice', TG_TABLE_NAME, lower(invoice_kind)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipt_allocation_tax_invoice
  BEFORE INSERT OR UPDATE OF "invoiceId" ON "receipt_allocations"
  FOR EACH ROW EXECUTE FUNCTION tax_invoice_only();
CREATE TRIGGER credit_note_tax_invoice
  BEFORE INSERT OR UPDATE OF "invoiceId" ON "credit_notes"
  FOR EACH ROW EXECUTE FUNCTION tax_invoice_only();
