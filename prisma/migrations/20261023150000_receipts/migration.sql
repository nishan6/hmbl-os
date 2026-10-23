-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "ledgerAccountId" UUID NOT NULL,
    "bankName" TEXT NOT NULL,
    "branch" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifsc" TEXT,
    "swift" TEXT,
    "iban" TEXT,
    "currency" CHAR(3) NOT NULL,
    "showOnInvoices" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "clientId" UUID NOT NULL,
    "depositAccountId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "currency" CHAR(3) NOT NULL,
    "fxRate" DECIMAL(18,8),
    "amountMinor" BIGINT NOT NULL,
    "tdsMinor" BIGINT NOT NULL DEFAULT 0,
    "tdsSection" TEXT,
    "notes" TEXT,
    "grossBaseMinor" BIGINT NOT NULL,
    "journalId" UUID NOT NULL,
    "voidDate" DATE,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_allocations" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "invoiceBaseMinor" BIGINT NOT NULL,
    "receiptBaseMinor" BIGINT NOT NULL,
    "journalId" UUID,
    "voidedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_ledgerAccountId_key" ON "bank_accounts"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "bank_accounts_legalEntityId_idx" ON "bank_accounts"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_journalId_key" ON "receipts"("journalId");

-- CreateIndex
CREATE INDEX "receipts_clientId_idx" ON "receipts"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_legalEntityId_number_key" ON "receipts"("legalEntityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_allocations_journalId_key" ON "receipt_allocations"("journalId");

-- CreateIndex
CREATE INDEX "receipt_allocations_receiptId_idx" ON "receipt_allocations"("receiptId");

-- CreateIndex
CREATE INDEX "receipt_allocations_invoiceId_idx" ON "receipt_allocations"("invoiceId");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_depositAccountId_fkey" FOREIGN KEY ("depositAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Amounts are never negative, and a receipt settles something.
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amounts_check" CHECK (
  "amountMinor" >= 0 AND "tdsMinor" >= 0 AND "amountMinor" + "tdsMinor" > 0
);
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voided_check" CHECK (
  ("status" = 'VOIDED') = ("voidedAt" IS NOT NULL AND "voidDate" IS NOT NULL)
);
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_amount_check" CHECK (
  "amountMinor" > 0
);

-- A receipt never changes once recorded, except to be voided once. It is
-- never deleted.
CREATE OR REPLACE FUNCTION receipt_guard() RETURNS trigger AS $$
DECLARE
  allowed text[] := ARRAY['updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receipt % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status = 'VOIDED' THEN
    allowed := allowed || ARRAY['status', 'voidDate', 'voidedAt', 'voidedById', 'voidReason'];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'receipt % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipt_guard
  BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION receipt_guard();

-- Allocations are added and voided, never edited or deleted. A new one must
-- fit within what its receipt has left and what its invoice still owes.
CREATE OR REPLACE FUNCTION receipt_allocation_guard() RETURNS trigger AS $$
DECLARE
  r receipts%ROWTYPE;
  inv sales_invoices%ROWTYPE;
  allocated bigint;
  credited bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receipt allocation % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."voidedAt" IS NULL AND NEW."voidedAt" IS NOT NULL
       AND (to_jsonb(NEW) - 'voidedAt') = (to_jsonb(OLD) - 'voidedAt') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'receipt allocation % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO r FROM receipts WHERE id = NEW."receiptId";
  SELECT * INTO inv FROM sales_invoices WHERE id = NEW."invoiceId";
  IF r.status <> 'POSTED' THEN
    RAISE EXCEPTION 'receipt % is voided', r.id USING ERRCODE = 'check_violation';
  END IF;
  IF inv.status <> 'ISSUED' OR inv."legalEntityId" <> r."legalEntityId"
     OR inv."clientId" <> r."clientId" OR inv.currency <> r.currency THEN
    RAISE EXCEPTION 'invoice % can''t take receipt %', inv.id, r.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated FROM receipt_allocations
   WHERE "receiptId" = r.id AND "voidedAt" IS NULL AND id <> NEW.id;
  IF allocated + NEW."amountMinor" > r."amountMinor" + r."tdsMinor" THEN
    RAISE EXCEPTION 'receipt % is over-allocated', r.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated FROM receipt_allocations
   WHERE "invoiceId" = inv.id AND "voidedAt" IS NULL AND id <> NEW.id;
  SELECT COALESCE(SUM("totalMinor"), 0) INTO credited FROM credit_notes
   WHERE "invoiceId" = inv.id AND status = 'ISSUED';
  IF allocated + credited + NEW."amountMinor" > inv."totalMinor" THEN
    RAISE EXCEPTION 'invoice % would be overpaid', inv.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipt_allocation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "receipt_allocations"
  FOR EACH ROW EXECUTE FUNCTION receipt_allocation_guard();
