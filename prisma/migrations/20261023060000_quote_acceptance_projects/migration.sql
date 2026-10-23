-- CreateEnum
CREATE TYPE "AcceptanceMethod" AS ENUM ('SIGNED_QUOTE', 'EMAIL', 'PURCHASE_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "acceptanceMethod" "AcceptanceMethod",
ADD COLUMN     "acceptanceNotes" TEXT,
ADD COLUMN     "acceptedByName" TEXT,
ADD COLUMN     "acceptedOn" DATE,
ADD COLUMN     "answerRecordedAt" TIMESTAMP(3),
ADD COLUMN     "answerRecordedById" UUID,
ADD COLUMN     "clientPoNumber" TEXT,
ADD COLUMN     "declinedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "clientId" UUID NOT NULL,
    "opportunityId" UUID,
    "quoteId" UUID NOT NULL,
    "sourceQuoteVersionId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fxRateToBase" DECIMAL(18,8),
    "contractValueMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "budgetCostMinor" BIGINT NOT NULL,
    "clientPoNumber" TEXT,
    "eventStartDate" DATE,
    "eventEndDate" DATE,
    "venue" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_budget_lines" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "section" TEXT,
    "category" "LineCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "days" DECIMAL(12,3) NOT NULL,
    "unitCode" TEXT,
    "costMinor" BIGINT NOT NULL,
    "revenueMinor" BIGINT NOT NULL,

    CONSTRAINT "project_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "percentBps" INTEGER NOT NULL,
    "trigger" "PaymentTrigger" NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" BIGINT NOT NULL,
    "dueDate" DATE,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_sourceQuoteVersionId_key" ON "projects"("sourceQuoteVersionId");

-- CreateIndex
CREATE INDEX "projects_clientId_idx" ON "projects"("clientId");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_legalEntityId_number_key" ON "projects"("legalEntityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "project_budget_lines_projectId_position_key" ON "project_budget_lines"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "project_milestones_projectId_position_key" ON "project_milestones"("projectId", "position");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_sourceQuoteVersionId_fkey" FOREIGN KEY ("sourceQuoteVersionId") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: an accepted version carries its evidence.
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_acceptance_check"
  CHECK (status <> 'ACCEPTED' OR
         ("acceptedOn" IS NOT NULL AND "acceptedByName" IS NOT NULL AND "acceptanceMethod" IS NOT NULL));

ALTER TABLE "projects" ADD CONSTRAINT "projects_amounts_check"
  CHECK ("contractValueMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0 AND "budgetCostMinor" >= 0);
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_amounts_check"
  CHECK ("costMinor" >= 0 AND "revenueMinor" >= 0);
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_amounts_check"
  CHECK ("percentBps" BETWEEN 0 AND 10000 AND "amountMinor" >= 0 AND days >= 0);

-- The client's answer is recorded on a frozen (issued) version, so its
-- columns join the ones that may change after draft.
CREATE OR REPLACE FUNCTION quote_version_frozen() RETURNS trigger AS $$
DECLARE
  workflow text[] := ARRAY['status', 'updatedAt', 'submittedAt', 'approvedAt', 'approvedById',
                           'issuedAt', 'issuedById', 'withdrawnAt', 'statusReason',
                           'declinedAt', 'acceptedOn', 'acceptedByName', 'acceptanceMethod',
                           'clientPoNumber', 'acceptanceNotes', 'answerRecordedAt',
                           'answerRecordedById'];
BEGIN
  IF OLD.status <> 'DRAFT' AND
     (to_jsonb(NEW) - workflow) IS DISTINCT FROM (to_jsonb(OLD) - workflow) THEN
    RAISE EXCEPTION 'quote version % is % and can no longer be edited', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
