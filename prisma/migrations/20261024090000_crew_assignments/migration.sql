-- CreateEnum
CREATE TYPE "CrewAssignmentStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrewWorkDay" AS ENUM ('FULL', 'HALF');

-- AlterTable
ALTER TABLE "vendor_bill_lines" ADD COLUMN     "commitmentId" UUID;

-- CreateTable
CREATE TABLE "crew_assignments" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID,
    "crewMemberId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "CrewAssignmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "budgetLineId" UUID,
    "currency" CHAR(3) NOT NULL,
    "dayRateMinor" BIGINT,
    "halfDayRateMinor" BIGINT,
    "overtimeRateMinor" BIGINT,
    "callTime" TEXT,
    "reportTo" TEXT,
    "notes" TEXT,
    "overrideReason" TEXT,
    "overrideById" UUID,
    "overrideAt" TIMESTAMP(3),
    "replacesId" UUID,
    "commitmentId" UUID,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "endedReason" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_work_records" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "day" "CrewWorkDay" NOT NULL DEFAULT 'FULL',
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "expensesMinor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "settlementId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_work_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_settlements" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "crewMemberId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crew_assignments_replacesId_key" ON "crew_assignments"("replacesId");

-- CreateIndex
CREATE UNIQUE INDEX "crew_assignments_commitmentId_key" ON "crew_assignments"("commitmentId");

-- CreateIndex
CREATE INDEX "crew_assignments_crewMemberId_startDate_idx" ON "crew_assignments"("crewMemberId", "startDate");

-- CreateIndex
CREATE INDEX "crew_assignments_projectId_idx" ON "crew_assignments"("projectId");

-- CreateIndex
CREATE INDEX "crew_work_records_settlementId_idx" ON "crew_work_records"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "crew_work_records_assignmentId_date_key" ON "crew_work_records"("assignmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "crew_settlements_billId_key" ON "crew_settlements"("billId");

-- CreateIndex
CREATE INDEX "crew_settlements_crewMemberId_idx" ON "crew_settlements"("crewMemberId");

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "project_resource_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "crew_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_work_records" ADD CONSTRAINT "crew_work_records_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "crew_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_work_records" ADD CONSTRAINT "crew_work_records_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "crew_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_settlements" ADD CONSTRAINT "crew_settlements_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_settlements" ADD CONSTRAINT "crew_settlements_billId_fkey" FOREIGN KEY ("billId") REFERENCES "vendor_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Dates in order, no negative rates, overtime and expenses within reason.
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_check"
  CHECK ("endDate" >= "startDate"
    AND ("dayRateMinor" IS NULL OR "dayRateMinor" >= 0)
    AND ("halfDayRateMinor" IS NULL OR "halfDayRateMinor" >= 0)
    AND ("overtimeRateMinor" IS NULL OR "overtimeRateMinor" >= 0));
ALTER TABLE "crew_work_records" ADD CONSTRAINT "crew_work_records_check"
  CHECK ("overtimeMinutes" BETWEEN 0 AND 1440 AND "expensesMinor" >= 0);
