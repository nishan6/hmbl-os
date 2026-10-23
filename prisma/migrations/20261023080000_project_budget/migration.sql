-- CreateEnum
CREATE TYPE "CostEntryKind" AS ENUM ('COMMITMENT', 'ACTUAL');

-- AlterTable
ALTER TABLE "project_budget_lines" ADD COLUMN     "costCodeId" UUID,
ADD COLUMN     "forecastCostMinor" BIGINT,
ADD COLUMN     "forecastNote" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "baselineLockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "cost_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LineCategory" NOT NULL,
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_cost_entries" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "budgetLineId" UUID NOT NULL,
    "kind" "CostEntryKind" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "reference" TEXT,
    "commitmentId" UUID,
    "closedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_codes_code_key" ON "cost_codes"("code");

-- CreateIndex
CREATE INDEX "project_cost_entries_projectId_idx" ON "project_cost_entries"("projectId");

-- CreateIndex
CREATE INDEX "project_cost_entries_budgetLineId_idx" ON "project_cost_entries"("budgetLineId");

-- AddForeignKey
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "cost_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "project_budget_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "project_cost_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written: invariants Prisma can't express (docs/budget.md).
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_rules_check"
  CHECK ("amountMinor" > 0
         AND ("commitmentId" IS NULL OR kind = 'ACTUAL')
         AND ("closedAt" IS NULL OR kind = 'COMMITMENT')
         AND (("voidedAt" IS NULL) = ("voidReason" IS NULL)));
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_forecast_check"
  CHECK ("forecastCostMinor" IS NULL OR "forecastCostMinor" >= 0);

-- Projects already past approval have a fixed baseline.
UPDATE "projects" SET "baselineLockedAt" = "createdAt" WHERE status NOT IN ('DRAFT', 'COMMERCIAL_REVIEW');

-- The original budget never changes once locked. Lines can still be added
-- with a zero baseline (change orders carry their amounts separately).
CREATE OR REPLACE FUNCTION project_budget_baseline_frozen() RETURNS trigger AS $$
DECLARE
  locked boolean;
BEGIN
  SELECT "baselineLockedAt" IS NOT NULL INTO locked FROM projects
   WHERE id = COALESCE(NEW."projectId", OLD."projectId");
  IF NOT locked THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'budget line % belongs to an approved budget and can''t be deleted', OLD.id
      USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW."costMinor" <> 0 OR NEW."revenueMinor" <> 0 THEN
      RAISE EXCEPTION 'a line added after approval starts with a zero baseline'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."costMinor" IS DISTINCT FROM OLD."costMinor"
     OR NEW."revenueMinor" IS DISTINCT FROM OLD."revenueMinor"
     OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
     OR NEW.category IS DISTINCT FROM OLD.category THEN
    RAISE EXCEPTION 'the approved budget of line % can''t be changed', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_budget_baseline_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "project_budget_lines"
  FOR EACH ROW EXECUTE FUNCTION project_budget_baseline_frozen();

-- Cost entries are append-only: only closing a commitment or voiding an
-- entry changes a row, once.
CREATE OR REPLACE FUNCTION project_cost_entry_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cost entries can''t be deleted; void them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['closedAt', 'voidedAt', 'voidReason'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['closedAt', 'voidedAt', 'voidReason'])
     OR (OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt")
     OR (OLD."voidedAt" IS NOT NULL AND (NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt"
                                         OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason")) THEN
    RAISE EXCEPTION 'cost entry % can''t be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_cost_entry_append_only
  BEFORE UPDATE OR DELETE ON "project_cost_entries"
  FOR EACH ROW EXECUTE FUNCTION project_cost_entry_append_only();
