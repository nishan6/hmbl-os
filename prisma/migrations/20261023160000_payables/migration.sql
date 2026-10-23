-- CreateEnum
CREATE TYPE "VendorKind" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'VOIDED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'VOIDED');

-- AlterTable
ALTER TABLE "project_cost_entries" ADD COLUMN     "sourceId" UUID,
ADD COLUMN     "sourceType" TEXT;

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "legalName" TEXT,
    "kind" "VendorKind" NOT NULL DEFAULT 'COMPANY',
    "email" TEXT,
    "phone" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "msmeNumber" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "tdsSection" TEXT,
    "tdsRateBps" INTEGER,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT,
    "status" "BillStatus" NOT NULL DEFAULT 'DRAFT',
    "vendorId" UUID NOT NULL,
    "vendorInvoiceNumber" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fxRate" DECIMAL(18,8),
    "supplyType" "SupplyType" NOT NULL,
    "vendorGstin" TEXT,
    "notes" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "cgstMinor" BIGINT NOT NULL DEFAULT 0,
    "sgstMinor" BIGINT NOT NULL DEFAULT 0,
    "igstMinor" BIGINT NOT NULL DEFAULT 0,
    "otherTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "tdsSection" TEXT,
    "tdsRateBps" INTEGER NOT NULL DEFAULT 0,
    "tdsMinor" BIGINT NOT NULL DEFAULT 0,
    "payableMinor" BIGINT NOT NULL DEFAULT 0,
    "basePayableMinor" BIGINT NOT NULL DEFAULT 0,
    "journalId" UUID,
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "rejectedReason" TEXT,
    "voidDate" DATE,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_lines" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
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
    "itcEligible" BOOLEAN NOT NULL DEFAULT true,
    "accountId" UUID NOT NULL,
    "projectId" UUID,
    "budgetLineId" UUID,
    "costEntryId" UUID,

    CONSTRAINT "vendor_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "vendorId" UUID NOT NULL,
    "paidFromId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "currency" CHAR(3) NOT NULL,
    "fxRate" DECIMAL(18,8),
    "amountMinor" BIGINT NOT NULL,
    "baseMinor" BIGINT NOT NULL,
    "notes" TEXT,
    "journalId" UUID NOT NULL,
    "voidDate" DATE,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_allocations" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "billBaseMinor" BIGINT NOT NULL,
    "paymentBaseMinor" BIGINT NOT NULL,
    "journalId" UUID,
    "voidedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_normalizedName_idx" ON "vendors"("normalizedName");

-- CreateIndex
CREATE INDEX "vendors_status_name_idx" ON "vendors"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_journalId_key" ON "vendor_bills"("journalId");

-- CreateIndex
CREATE INDEX "vendor_bills_vendorId_idx" ON "vendor_bills"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_bills_legalEntityId_status_idx" ON "vendor_bills"("legalEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_legalEntityId_number_key" ON "vendor_bills"("legalEntityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bill_lines_costEntryId_key" ON "vendor_bill_lines"("costEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bill_lines_billId_position_key" ON "vendor_bill_lines"("billId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payments_journalId_key" ON "vendor_payments"("journalId");

-- CreateIndex
CREATE INDEX "vendor_payments_vendorId_idx" ON "vendor_payments"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payments_legalEntityId_number_key" ON "vendor_payments"("legalEntityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payment_allocations_journalId_key" ON "vendor_payment_allocations"("journalId");

-- CreateIndex
CREATE INDEX "vendor_payment_allocations_paymentId_idx" ON "vendor_payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "vendor_payment_allocations_billId_idx" ON "vendor_payment_allocations"("billId");

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_paidFromId_fkey" FOREIGN KEY ("paidFromId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "vendor_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "vendor_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Guards ─────────────────────────────────────────────────────────────────

ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_approved_check" CHECK (
  "status" NOT IN ('APPROVED', 'VOIDED')
  OR ("number" IS NOT NULL AND "journalId" IS NOT NULL AND "approvedAt" IS NOT NULL)
);
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_voided_check" CHECK (
  ("status" = 'VOIDED') = ("voidDate" IS NOT NULL AND "voidedAt" IS NOT NULL)
);
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_amounts_check" CHECK (
  "tdsMinor" >= 0 AND "payableMinor" = "totalMinor" - "tdsMinor"
);
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_amounts_check" CHECK (
  "amountMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" = "amountMinor" + "taxMinor"
);
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_voided_check" CHECK (
  ("status" = 'VOIDED') = ("voidedAt" IS NOT NULL AND "voidDate" IS NOT NULL)
);
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "vendor_payment_allocations_amount_check" CHECK (
  "amountMinor" > 0
);

-- An approved bill changes only to be voided, once. Voided and discarded
-- bills never change. Only drafts are deleted.
CREATE OR REPLACE FUNCTION vendor_bill_guard() RETURNS trigger AS $$
DECLARE
  allowed text[] := ARRAY['updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'vendor bill % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('DRAFT', 'SUBMITTED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status = 'VOIDED' THEN
    allowed := allowed || ARRAY['status', 'voidDate', 'voidedAt', 'voidReason'];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'vendor bill % is % and can''t be changed', OLD.id, lower(OLD.status::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_bill_guard
  BEFORE UPDATE OR DELETE ON "vendor_bills"
  FOR EACH ROW EXECUTE FUNCTION vendor_bill_guard();

-- Lines change only while their bill is a draft or awaiting approval.
CREATE OR REPLACE FUNCTION vendor_bill_line_guard() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status::text INTO parent_status FROM vendor_bills
   WHERE id = COALESCE(NEW."billId", OLD."billId");
  IF parent_status IS NOT NULL AND parent_status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'lines of a % bill can''t be changed', lower(parent_status)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_bill_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "vendor_bill_lines"
  FOR EACH ROW EXECUTE FUNCTION vendor_bill_line_guard();

-- A payment never changes once recorded, except to be voided once.
CREATE OR REPLACE FUNCTION vendor_payment_guard() RETURNS trigger AS $$
DECLARE
  allowed text[] := ARRAY['updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vendor payment % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status = 'VOIDED' THEN
    allowed := allowed || ARRAY['status', 'voidDate', 'voidedAt', 'voidedById', 'voidReason'];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'vendor payment % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_payment_guard
  BEFORE UPDATE OR DELETE ON "vendor_payments"
  FOR EACH ROW EXECUTE FUNCTION vendor_payment_guard();

-- Allocations are added and voided, never edited or deleted, and never pay
-- a bill more than is payable or use more of a payment than it has.
CREATE OR REPLACE FUNCTION vendor_payment_allocation_guard() RETURNS trigger AS $$
DECLARE
  p vendor_payments%ROWTYPE;
  b vendor_bills%ROWTYPE;
  allocated bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment allocation % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."voidedAt" IS NULL AND NEW."voidedAt" IS NOT NULL
       AND (to_jsonb(NEW) - 'voidedAt') = (to_jsonb(OLD) - 'voidedAt') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'payment allocation % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO p FROM vendor_payments WHERE id = NEW."paymentId";
  SELECT * INTO b FROM vendor_bills WHERE id = NEW."billId";
  IF p.status <> 'POSTED' THEN
    RAISE EXCEPTION 'payment % is voided', p.id USING ERRCODE = 'check_violation';
  END IF;
  IF b.status <> 'APPROVED' OR b."legalEntityId" <> p."legalEntityId"
     OR b."vendorId" <> p."vendorId" OR b.currency <> p.currency THEN
    RAISE EXCEPTION 'bill % can''t take payment %', b.id, p.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated FROM vendor_payment_allocations
   WHERE "paymentId" = p.id AND "voidedAt" IS NULL AND id <> NEW.id;
  IF allocated + NEW."amountMinor" > p."amountMinor" THEN
    RAISE EXCEPTION 'payment % is over-allocated', p.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated FROM vendor_payment_allocations
   WHERE "billId" = b.id AND "voidedAt" IS NULL AND id <> NEW.id;
  IF allocated + NEW."amountMinor" > b."payableMinor" THEN
    RAISE EXCEPTION 'bill % would be overpaid', b.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_payment_allocation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "vendor_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION vendor_payment_allocation_guard();
