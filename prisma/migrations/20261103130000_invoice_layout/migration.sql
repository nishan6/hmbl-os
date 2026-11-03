-- What HMBL's own invoice layout needs: line sections and item lists, invoice
-- terms and advance, the entity's invoice contact block and signatory, and
-- UPI on bank accounts.

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "upiId" TEXT;

-- AlterTable
ALTER TABLE "finance_settings" ADD COLUMN     "invoiceContact" TEXT,
ADD COLUMN     "invoiceSignatoryName" TEXT,
ADD COLUMN     "invoiceSignatoryTitle" TEXT,
ADD COLUMN     "invoiceTerms" TEXT,
ADD COLUMN     "invoiceWebsite" TEXT;

-- AlterTable
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "details" TEXT,
ADD COLUMN     "section" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "advanceMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "terms" TEXT;

