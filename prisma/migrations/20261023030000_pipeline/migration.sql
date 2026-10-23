-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OPEN', 'WON', 'LOST', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'CALL', 'MEETING', 'EMAIL', 'FOLLOW_UP');

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StageKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "probabilityBps" INTEGER,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "contactId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stageId" UUID NOT NULL,
    "ownerId" UUID,
    "businessUnitId" UUID,
    "source" TEXT,
    "expectedValueMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "probabilityBps" INTEGER,
    "expectedCloseDate" DATE,
    "eventStartDate" DATE,
    "eventEndDate" DATE,
    "venue" TEXT,
    "competitors" TEXT,
    "outcomeReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_stage_changes" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "fromStageId" UUID,
    "toStageId" UUID NOT NULL,
    "reason" TEXT,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "opportunityId" UUID,
    "type" "ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "ownerId" UUID,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_key_key" ON "pipeline_stages"("key");

-- CreateIndex
CREATE INDEX "opportunities_legalEntityId_stageId_idx" ON "opportunities"("legalEntityId", "stageId");

-- CreateIndex
CREATE INDEX "opportunities_clientId_idx" ON "opportunities"("clientId");

-- CreateIndex
CREATE INDEX "opportunity_stage_changes_opportunityId_changedAt_idx" ON "opportunity_stage_changes"("opportunityId", "changedAt");

-- CreateIndex
CREATE INDEX "crm_activities_clientId_occurredAt_idx" ON "crm_activities"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "crm_activities_opportunityId_occurredAt_idx" ON "crm_activities"("opportunityId", "occurredAt");

-- CreateIndex
CREATE INDEX "crm_activities_ownerId_dueAt_idx" ON "crm_activities"("ownerId", "dueAt");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_changes" ADD CONSTRAINT "opportunity_stage_changes_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: value ranges and date order.
ALTER TABLE "pipeline_stages"
  ADD CONSTRAINT "pipeline_stages_probability_range" CHECK ("probabilityBps" IS NULL OR "probabilityBps" BETWEEN 0 AND 10000);
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "opportunities_value_not_negative" CHECK ("expectedValueMinor" IS NULL OR "expectedValueMinor" >= 0),
  ADD CONSTRAINT "opportunities_probability_range" CHECK ("probabilityBps" IS NULL OR "probabilityBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "opportunities_event_dates_order" CHECK ("eventEndDate" IS NULL OR "eventStartDate" IS NULL OR "eventEndDate" >= "eventStartDate");
