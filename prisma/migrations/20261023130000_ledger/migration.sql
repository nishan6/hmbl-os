-- CreateEnum
CREATE TYPE "RevenueRecognition" AS ENUM ('ON_INVOICE', 'ON_COMPLETION');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountSubtype" AS ENUM ('CASH', 'BANK', 'RECEIVABLE', 'CURRENT_ASSET', 'FIXED_ASSET', 'PAYABLE', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'EQUITY', 'REVENUE', 'OTHER_INCOME', 'DIRECT_COST', 'OPERATING_EXPENSE');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'OPENING_BALANCE', 'REVERSAL', 'SALES_INVOICE', 'CREDIT_NOTE', 'RECEIPT', 'VENDOR_BILL', 'VENDOR_PAYMENT', 'EXPENSE_CLAIM', 'ADVANCE', 'BANK', 'PERIOD_CLOSE');

-- CreateTable
CREATE TABLE "finance_settings" (
    "legalEntityId" UUID NOT NULL,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "revenueRecognition" "RevenueRecognition" NOT NULL DEFAULT 'ON_INVOICE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("legalEntityId")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "subtype" "AccountSubtype" NOT NULL,
    "description" TEXT,
    "systemKey" TEXT,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT,
    "date" DATE NOT NULL,
    "periodId" UUID,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "JournalSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" UUID,
    "sourceRef" TEXT,
    "narration" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "reversalOfId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedById" UUID,
    "createdById" UUID,
    "createdByLabel" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "debitMinor" BIGINT NOT NULL DEFAULT 0,
    "creditMinor" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "txCurrency" CHAR(3),
    "txAmountMinor" BIGINT,
    "fxRate" DECIMAL(18,8),
    "partyType" TEXT,
    "partyId" UUID,
    "projectId" UUID,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_accounts_legalEntityId_type_idx" ON "ledger_accounts"("legalEntityId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_legalEntityId_code_key" ON "ledger_accounts"("legalEntityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_legalEntityId_systemKey_key" ON "ledger_accounts"("legalEntityId", "systemKey");

-- CreateIndex
CREATE INDEX "accounting_periods_legalEntityId_fiscalYear_idx" ON "accounting_periods"("legalEntityId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_legalEntityId_startDate_key" ON "accounting_periods"("legalEntityId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "journals_reversalOfId_key" ON "journals"("reversalOfId");

-- CreateIndex
CREATE INDEX "journals_legalEntityId_date_idx" ON "journals"("legalEntityId", "date");

-- CreateIndex
CREATE INDEX "journals_source_sourceId_idx" ON "journals"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "journals_legalEntityId_number_key" ON "journals"("legalEntityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "journals_legalEntityId_idempotencyKey_key" ON "journals"("legalEntityId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_projectId_idx" ON "journal_lines"("projectId");

-- CreateIndex
CREATE INDEX "journal_lines_partyType_partyId_idx" ON "journal_lines"("partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journalId_position_key" ON "journal_lines"("journalId", "position");

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Ledger invariants (docs/ledger.md) ─────────────────────────────────────

-- An account's subtype belongs to its type.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_subtype_check" CHECK (
  ("type" = 'ASSET' AND "subtype" IN ('CASH', 'BANK', 'RECEIVABLE', 'CURRENT_ASSET', 'FIXED_ASSET'))
  OR ("type" = 'LIABILITY' AND "subtype" IN ('PAYABLE', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'))
  OR ("type" = 'EQUITY' AND "subtype" = 'EQUITY')
  OR ("type" = 'INCOME' AND "subtype" IN ('REVENUE', 'OTHER_INCOME'))
  OR ("type" = 'EXPENSE' AND "subtype" IN ('DIRECT_COST', 'OPERATING_EXPENSE'))
);

-- Each line is a debit or a credit, never both, never negative.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amount_check" CHECK (
  "debitMinor" >= 0 AND "creditMinor" >= 0 AND ("debitMinor" > 0) <> ("creditMinor" > 0)
);

ALTER TABLE "journals" ADD CONSTRAINT "journals_posted_check" CHECK (
  "status" <> 'POSTED'
  OR ("number" IS NOT NULL AND "periodId" IS NOT NULL AND "postedAt" IS NOT NULL)
);

-- Journals start as drafts. Posting checks that the journal balances, has
-- at least two lines, uses only this entity's accounts and lands in an open
-- period that contains its date. A posted or discarded journal never changes
-- and is never deleted: corrections are reversing journals.
CREATE OR REPLACE FUNCTION journal_guard() RETURNS trigger AS $$
DECLARE
  debits numeric;
  credits numeric;
  line_count int;
  foreign_lines int;
  p record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'journals are created as drafts and then posted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'journal % is % and can''t be deleted', OLD.id, lower(OLD.status::text)
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'journal % is % and can''t be changed', OLD.id, lower(OLD.status::text)
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'POSTED' THEN
    SELECT COALESCE(sum("debitMinor"), 0), COALESCE(sum("creditMinor"), 0), count(*)
      INTO debits, credits, line_count
      FROM journal_lines WHERE "journalId" = NEW.id;
    IF line_count < 2 THEN
      RAISE EXCEPTION 'journal % needs at least two lines', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    IF debits <> credits THEN
      RAISE EXCEPTION 'journal % doesn''t balance: debits % and credits %', NEW.id, debits, credits
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."totalMinor" <> debits THEN
      RAISE EXCEPTION 'journal % total doesn''t match its lines', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO foreign_lines
      FROM journal_lines l JOIN ledger_accounts a ON a.id = l."accountId"
     WHERE l."journalId" = NEW.id AND a."legalEntityId" <> NEW."legalEntityId";
    IF foreign_lines > 0 THEN
      RAISE EXCEPTION 'journal % uses another entity''s accounts', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO p FROM accounting_periods WHERE id = NEW."periodId" FOR SHARE;
    IF p IS NULL OR p."legalEntityId" <> NEW."legalEntityId"
       OR NEW.date < p."startDate" OR NEW.date > p."endDate" THEN
      RAISE EXCEPTION 'journal % is dated outside its period', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    IF p.status <> 'OPEN' THEN
      RAISE EXCEPTION 'the period % is closed', p.name USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "journals"
  FOR EACH ROW EXECUTE FUNCTION journal_guard();

-- Lines change only while their journal is a draft.
CREATE OR REPLACE FUNCTION journal_line_guard() RETURNS trigger AS $$
DECLARE
  journal_status text;
BEGIN
  SELECT status::text INTO journal_status FROM journals
   WHERE id = COALESCE(NEW."journalId", OLD."journalId");
  -- The journal itself is being deleted (drafts only) and cascades here.
  IF journal_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF journal_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'lines of a % journal can''t be changed', lower(journal_status)
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."journalId" <> OLD."journalId" THEN
    RAISE EXCEPTION 'a line can''t move to another journal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_line_guard();
