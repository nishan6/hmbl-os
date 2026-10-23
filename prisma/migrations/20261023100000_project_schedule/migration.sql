-- CreateEnum
CREATE TYPE "ScheduleItemKind" AS ENUM ('SHOW', 'PHASE', 'MILESTONE');

-- AlterTable
ALTER TABLE "project_milestones" ADD COLUMN     "dueDateManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dueDateNote" TEXT;

-- CreateTable
CREATE TABLE "project_schedule_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ScheduleItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "location" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_schedule_items_projectId_startDate_idx" ON "project_schedule_items"("projectId", "startDate");

-- AddForeignKey
ALTER TABLE "project_schedule_items" ADD CONSTRAINT "project_schedule_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_schedule_items" ADD CONSTRAINT "project_schedule_items_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_schedule_items" ADD CONSTRAINT "project_schedule_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Dates in order; milestones are one day; only milestones are completed.
ALTER TABLE "project_schedule_items" ADD CONSTRAINT "project_schedule_items_dates_check"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "project_schedule_items" ADD CONSTRAINT "project_schedule_items_kind_check"
  CHECK ("kind" = 'MILESTONE' OR "completedAt" IS NULL);
ALTER TABLE "project_schedule_items" ADD CONSTRAINT "project_schedule_items_milestone_check"
  CHECK ("kind" <> 'MILESTONE' OR "endDate" IS NULL);
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_manual_note_check"
  CHECK (NOT "dueDateManual" OR ("dueDate" IS NOT NULL AND "dueDateNote" IS NOT NULL));

-- Existing projects with event dates get them as their show dates.
INSERT INTO "project_schedule_items"
  ("id", "projectId", "kind", "title", "startDate", "endDate", "location", "createdById", "updatedAt")
SELECT gen_random_uuid(), p."id", 'SHOW', 'Show', p."eventStartDate",
       NULLIF(p."eventEndDate", p."eventStartDate"), p."venue", p."createdById", CURRENT_TIMESTAMP
FROM "projects" p
WHERE p."eventStartDate" IS NOT NULL;
