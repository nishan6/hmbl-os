-- CreateEnum
CREATE TYPE "ExpenseClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'VOIDED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SettlementKind" AS ENUM ('ADVANCE', 'PAYMENT');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "limitMinor" BIGINT,
    "limitCurrency" CHAR(3),
    "receiptRequired" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_advances" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'POSTED',
    "personId" UUID NOT NULL,
    "projectId" UUID,
    "purpose" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "paidFromId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "journalId" UUID NOT NULL,
    "voidDate" DATE,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_returns" (
    "id" UUID NOT NULL,
    "advanceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "depositAccountId" UUID NOT NULL,
    "reference" TEXT,
    "journalId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT,
    "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "claimantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "rejectedReason" TEXT,
    "journalId" UUID,
    "voidDate" DATE,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claim_lines" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "categoryId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "accountId" UUID NOT NULL,
    "projectId" UUID,
    "budgetLineId" UUID,
    "amountMinor" BIGINT NOT NULL,
    "spentCurrency" CHAR(3),
    "spentAmountMinor" BIGINT,
    "overLimit" BOOLEAN NOT NULL DEFAULT false,
    "missingReceipt" BOOLEAN NOT NULL DEFAULT false,
    "policyNote" TEXT,
    "costEntryId" UUID,

    CONSTRAINT "expense_claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_receipts" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "lineId" UUID,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_settlements" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "kind" "SettlementKind" NOT NULL,
    "advanceId" UUID,
    "paidFromId" UUID,
    "date" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reference" TEXT,
    "journalId" UUID NOT NULL,
    "voidDate" DATE,
    "voidedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_key_key" ON "expense_categories"("key");

-- CreateIndex
CREATE UNIQUE INDEX "staff_advances_journalId_key" ON "staff_advances"("journalId");

-- CreateIndex
CREATE INDEX "staff_advances_personId_idx" ON "staff_advances"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_advances_legalEntityId_number_key" ON "staff_advances"("legalEntityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "advance_returns_journalId_key" ON "advance_returns"("journalId");

-- CreateIndex
CREATE INDEX "advance_returns_advanceId_idx" ON "advance_returns"("advanceId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_journalId_key" ON "expense_claims"("journalId");

-- CreateIndex
CREATE INDEX "expense_claims_claimantId_idx" ON "expense_claims"("claimantId");

-- CreateIndex
CREATE INDEX "expense_claims_status_idx" ON "expense_claims"("status");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_legalEntityId_number_key" ON "expense_claims"("legalEntityId", "number");

-- CreateIndex
CREATE INDEX "expense_claim_lines_claimId_idx" ON "expense_claim_lines"("claimId");

-- CreateIndex
CREATE INDEX "expense_claim_lines_projectId_idx" ON "expense_claim_lines"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_receipts_storageKey_key" ON "expense_receipts"("storageKey");

-- CreateIndex
CREATE INDEX "expense_receipts_claimId_idx" ON "expense_receipts"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_settlements_journalId_key" ON "expense_settlements"("journalId");

-- CreateIndex
CREATE INDEX "expense_settlements_claimId_idx" ON "expense_settlements"("claimId");

-- CreateIndex
CREATE INDEX "expense_settlements_advanceId_idx" ON "expense_settlements"("advanceId");

-- AddForeignKey
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_personId_fkey" FOREIGN KEY ("personId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_paidFromId_fkey" FOREIGN KEY ("paidFromId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_returns" ADD CONSTRAINT "advance_returns_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "staff_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_returns" ADD CONSTRAINT "advance_returns_depositAccountId_fkey" FOREIGN KEY ("depositAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "expense_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "expense_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "expense_claim_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "expense_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "staff_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_paidFromId_fkey" FOREIGN KEY ("paidFromId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Guards ─────────────────────────────────────────────────────────────────

ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_voided_check" CHECK (
  ("status" = 'VOIDED') = ("voidDate" IS NOT NULL AND "voidedAt" IS NOT NULL)
);
ALTER TABLE "advance_returns" ADD CONSTRAINT "advance_returns_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_submitted_check" CHECK (
  "status" IN ('DRAFT', 'DISCARDED') OR "number" IS NOT NULL
);
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_approved_check" CHECK (
  "status" NOT IN ('APPROVED', 'VOIDED')
  OR ("journalId" IS NOT NULL AND "approvedAt" IS NOT NULL)
);
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_voided_check" CHECK (
  ("status" = 'VOIDED') = ("voidDate" IS NOT NULL AND "voidedAt" IS NOT NULL)
);
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_kind_check" CHECK (
  ("kind" = 'ADVANCE' AND "advanceId" IS NOT NULL AND "paidFromId" IS NULL)
  OR ("kind" = 'PAYMENT' AND "paidFromId" IS NOT NULL AND "advanceId" IS NULL)
);

-- An approved claim changes only to be voided, once. Only drafts are deleted.
CREATE OR REPLACE FUNCTION expense_claim_guard() RETURNS trigger AS $$
DECLARE
  allowed text[] := ARRAY['updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'expense claim % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
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
    RAISE EXCEPTION 'expense claim % is % and can''t be changed', OLD.id, lower(OLD.status::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_claim_guard
  BEFORE UPDATE OR DELETE ON "expense_claims"
  FOR EACH ROW EXECUTE FUNCTION expense_claim_guard();

-- Lines change only while their claim is a draft or awaiting approval.
CREATE OR REPLACE FUNCTION expense_claim_line_guard() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status::text INTO parent_status FROM expense_claims
   WHERE id = COALESCE(NEW."claimId", OLD."claimId");
  IF parent_status IS NOT NULL AND parent_status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'lines of a % expense claim can''t be changed', lower(parent_status)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_claim_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "expense_claim_lines"
  FOR EACH ROW EXECUTE FUNCTION expense_claim_line_guard();

-- Receipts are evidence: never deleted, and only re-linked when a draft line goes.
CREATE OR REPLACE FUNCTION expense_receipt_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expense receipt % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'lineId') IS DISTINCT FROM (to_jsonb(OLD) - 'lineId') THEN
    RAISE EXCEPTION 'expense receipt % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_receipt_guard
  BEFORE UPDATE OR DELETE ON "expense_receipts"
  FOR EACH ROW EXECUTE FUNCTION expense_receipt_guard();

-- An advance never changes once paid, except to be voided once.
CREATE OR REPLACE FUNCTION staff_advance_guard() RETURNS trigger AS $$
DECLARE
  allowed text[] := ARRAY['updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'advance % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status = 'VOIDED' THEN
    allowed := allowed || ARRAY['status', 'voidDate', 'voidedAt', 'voidReason'];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'advance % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_advance_guard
  BEFORE UPDATE OR DELETE ON "staff_advances"
  FOR EACH ROW EXECUTE FUNCTION staff_advance_guard();

-- What has been used of an advance: live settlements plus returns.
CREATE OR REPLACE FUNCTION advance_used(advance uuid, excluding uuid) RETURNS bigint AS $$
  SELECT COALESCE((SELECT SUM("amountMinor") FROM expense_settlements
                    WHERE "advanceId" = advance AND "voidedAt" IS NULL AND id <> excluding), 0)
       + COALESCE((SELECT SUM("amountMinor") FROM advance_returns
                    WHERE "advanceId" = advance AND id <> excluding), 0);
$$ LANGUAGE sql STABLE;

-- Returns are never changed or deleted, and never exceed what is left.
CREATE OR REPLACE FUNCTION advance_return_guard() RETURNS trigger AS $$
DECLARE
  a staff_advances%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'advance return % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO a FROM staff_advances WHERE id = NEW."advanceId" FOR UPDATE;
  IF a.status <> 'POSTED' THEN
    RAISE EXCEPTION 'advance % is voided', a.id USING ERRCODE = 'check_violation';
  END IF;
  IF advance_used(a.id, NEW.id) + NEW."amountMinor" > a."amountMinor" THEN
    RAISE EXCEPTION 'advance % would be over-used', a.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER advance_return_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "advance_returns"
  FOR EACH ROW EXECUTE FUNCTION advance_return_guard();

-- Settlements are added and voided, never edited or deleted. They never pay a
-- claim more than its total, or use more of an advance than is left of it.
CREATE OR REPLACE FUNCTION expense_settlement_guard() RETURNS trigger AS $$
DECLARE
  c expense_claims%ROWTYPE;
  a staff_advances%ROWTYPE;
  settled bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlement % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."voidedAt" IS NULL AND NEW."voidedAt" IS NOT NULL AND NEW."voidDate" IS NOT NULL
       AND (to_jsonb(NEW) - 'voidedAt' - 'voidDate') = (to_jsonb(OLD) - 'voidedAt' - 'voidDate') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'settlement % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO c FROM expense_claims WHERE id = NEW."claimId";
  IF c.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'expense claim % isn''t approved', c.id USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO settled FROM expense_settlements
   WHERE "claimId" = c.id AND "voidedAt" IS NULL AND id <> NEW.id;
  IF settled + NEW."amountMinor" > c."totalMinor" THEN
    RAISE EXCEPTION 'expense claim % would be over-settled', c.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'ADVANCE' THEN
    SELECT * INTO a FROM staff_advances WHERE id = NEW."advanceId" FOR UPDATE;
    IF a.status <> 'POSTED' OR a."legalEntityId" <> c."legalEntityId"
       OR a."personId" <> c."claimantId" OR a.currency <> c.currency THEN
      RAISE EXCEPTION 'advance % can''t settle claim %', a.id, c.id USING ERRCODE = 'check_violation';
    END IF;
    IF advance_used(a.id, NEW.id) + NEW."amountMinor" > a."amountMinor" THEN
      RAISE EXCEPTION 'advance % would be over-used', a.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_settlement_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "expense_settlements"
  FOR EACH ROW EXECUTE FUNCTION expense_settlement_guard();

-- Everyone who works on projects can claim expenses (docs/expenses.md).
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r."id", p.permission
  FROM "roles" r
  CROSS JOIN (VALUES ('expenses.view'), ('expenses.create'), ('expenses.submit')) AS p(permission)
 WHERE r."isSystem" AND r."key" IN ('owner', 'finance', 'sales', 'project_manager')
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r."id", 'expenses.view' FROM "roles" r
 WHERE r."isSystem" AND r."key" IN ('administrator', 'viewer')
ON CONFLICT DO NOTHING;
