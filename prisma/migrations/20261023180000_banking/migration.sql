-- CreateEnum
CREATE TYPE "BankStatementSource" AS ENUM ('CSV', 'MANUAL');

-- CreateEnum
CREATE TYPE "BankMatchKind" AS ENUM ('STATEMENT', 'OPENING');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('COMPLETED', 'REOPENED');

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "source" "BankStatementSource" NOT NULL,
    "fileName" TEXT,
    "sha256" TEXT,
    "lineCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "importedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "balanceMinor" BIGINT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_matches" (
    "id" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "kind" "BankMatchKind" NOT NULL,
    "statementLineId" UUID,
    "journalLineId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "statementDate" DATE NOT NULL,
    "statementBalanceMinor" BIGINT NOT NULL,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'COMPLETED',
    "completedById" UUID NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedById" UUID,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statement_imports_bankAccountId_idx" ON "bank_statement_imports"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_bankAccountId_date_idx" ON "bank_statement_lines"("bankAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_bankAccountId_dedupeKey_key" ON "bank_statement_lines"("bankAccountId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "bank_matches_journalLineId_key" ON "bank_matches"("journalLineId");

-- CreateIndex
CREATE INDEX "bank_matches_bankAccountId_idx" ON "bank_matches"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_matches_statementLineId_idx" ON "bank_matches"("statementLineId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_bankAccountId_statementDate_idx" ON "bank_reconciliations"("bankAccountId", "statementDate");

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "bank_statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Guards (docs/banking.md) ────────────────────────────────────────────────

ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_amount_check"
  CHECK ("amountMinor" <> 0);
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_amount_check"
  CHECK ("amountMinor" <> 0);
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_kind_check"
  CHECK (("kind" = 'STATEMENT') = ("statementLineId" IS NOT NULL));

-- The statement date up to which a bank account is reconciled, or null.
CREATE OR REPLACE FUNCTION bank_reconciled_to(account uuid) RETURNS date AS $$
  SELECT MAX("statementDate") FROM bank_reconciliations
   WHERE "bankAccountId" = account AND status = 'COMPLETED';
$$ LANGUAGE sql STABLE;

-- Statement lines are never edited. They can't be added to, or removed from,
-- a reconciled period; a matched line can't be removed (foreign key).
CREATE OR REPLACE FUNCTION bank_statement_line_guard() RETURNS trigger AS $$
DECLARE
  locked date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'statement line % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  locked := bank_reconciled_to(CASE WHEN TG_OP = 'DELETE' THEN OLD."bankAccountId" ELSE NEW."bankAccountId" END);
  IF locked IS NOT NULL AND (CASE WHEN TG_OP = 'DELETE' THEN OLD.date ELSE NEW.date END) <= locked THEN
    RAISE EXCEPTION 'the bank account is reconciled to %', locked USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_statement_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "bank_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION bank_statement_line_guard();

-- A match pairs a posted ledger line on the bank account's ledger account with
-- one of its statement lines, or clears it into the opening balance before
-- the first reconciliation. Matches are added and removed, never edited, and
-- not removed once their statement line is reconciled.
CREATE OR REPLACE FUNCTION bank_match_guard() RETURNS trigger AS $$
DECLARE
  m bank_matches%ROWTYPE;
  locked date;
  line_date date;
  ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'bank match % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  m := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  locked := bank_reconciled_to(m."bankAccountId");
  IF m.kind = 'OPENING' THEN
    IF locked IS NOT NULL THEN
      RAISE EXCEPTION 'opening items are fixed once the account is reconciled' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT date INTO line_date FROM bank_statement_lines
     WHERE id = m."statementLineId" AND "bankAccountId" = m."bankAccountId";
    IF line_date IS NULL THEN
      RAISE EXCEPTION 'statement line % isn''t on this bank account', m."statementLineId" USING ERRCODE = 'check_violation';
    END IF;
    IF locked IS NOT NULL AND line_date <= locked THEN
      RAISE EXCEPTION 'the bank account is reconciled to %', locked USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM journal_lines jl
        JOIN journals j ON j.id = jl."journalId"
        JOIN bank_accounts b ON b."ledgerAccountId" = jl."accountId"
       WHERE jl.id = NEW."journalLineId" AND b.id = NEW."bankAccountId" AND j.status = 'POSTED'
    ) INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'ledger line % isn''t a posted line of this bank account', NEW."journalLineId" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_match_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "bank_matches"
  FOR EACH ROW EXECUTE FUNCTION bank_match_guard();

-- Reconciliations move forward in date, are never deleted, and only the latest
-- can be reopened.
CREATE OR REPLACE FUNCTION bank_reconciliation_guard() RETURNS trigger AS $$
DECLARE
  locked date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliation % can''t be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  locked := bank_reconciled_to(NEW."bankAccountId");
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'COMPLETED' OR (locked IS NOT NULL AND NEW."statementDate" <= locked) THEN
      RAISE EXCEPTION 'the bank account is already reconciled to %', locked USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'COMPLETED' AND NEW.status = 'REOPENED' AND OLD."statementDate" = locked
     AND NEW."reopenedAt" IS NOT NULL AND NEW."reopenedById" IS NOT NULL AND NEW."reopenReason" IS NOT NULL
     AND (to_jsonb(NEW) - 'status' - 'reopenedAt' - 'reopenedById' - 'reopenReason')
       = (to_jsonb(OLD) - 'status' - 'reopenedAt' - 'reopenedById' - 'reopenReason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'reconciliation % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_reconciliation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "bank_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION bank_reconciliation_guard();
