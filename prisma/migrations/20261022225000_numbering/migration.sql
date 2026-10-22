-- CreateEnum
CREATE TYPE "NumberResetPolicy" AS ENUM ('NEVER', 'YEARLY', 'FISCAL_YEARLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "numbering_schemes" (
    "id" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "pattern" TEXT NOT NULL,
    "resetPolicy" "NumberResetPolicy" NOT NULL,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "startAt" INTEGER NOT NULL DEFAULT 1,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "numbering_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_counters" (
    "schemeId" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_counters_pkey" PRIMARY KEY ("schemeId","periodKey")
);

-- CreateIndex
CREATE INDEX "numbering_schemes_legalEntityId_idx" ON "numbering_schemes"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "numbering_schemes_active_key" ON "numbering_schemes"("documentType", "legalEntityId") WHERE (status = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "numbering_schemes" ADD CONSTRAINT "numbering_schemes_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_counters" ADD CONSTRAINT "number_counters_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "numbering_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written guards.
ALTER TABLE "numbering_schemes"
  ADD CONSTRAINT "numbering_schemes_fiscal_month" CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT "numbering_schemes_start_at" CHECK ("startAt" >= 1);
ALTER TABLE "number_counters"
  ADD CONSTRAINT "number_counters_positive" CHECK ("lastValue" >= 1);
