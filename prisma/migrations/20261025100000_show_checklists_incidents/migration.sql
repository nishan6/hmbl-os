-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('SAFETY', 'INJURY', 'TECHNICAL', 'EQUIPMENT', 'CREW', 'VENUE', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "show_checklists" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "day" DATE,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "archivedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "show_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_checklist_items" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneById" UUID,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "show_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_incidents" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "peopleInvolved" TEXT,
    "actionTaken" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "reportedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "show_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "show_checklists_projectId_idx" ON "show_checklists"("projectId");

-- CreateIndex
CREATE INDEX "show_checklist_items_checklistId_position_idx" ON "show_checklist_items"("checklistId", "position");

-- CreateIndex
CREATE INDEX "show_incidents_projectId_occurredAt_idx" ON "show_incidents"("projectId", "occurredAt");

-- AddForeignKey
ALTER TABLE "show_checklists" ADD CONSTRAINT "show_checklists_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_checklist_items" ADD CONSTRAINT "show_checklist_items_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "show_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_incidents" ADD CONSTRAINT "show_incidents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: invariants Prisma can't express.

ALTER TABLE "show_checklist_items"
  ADD CONSTRAINT "show_checklist_items_done_check"
  CHECK (("doneAt" IS NULL) = ("doneById" IS NULL)),
  ADD CONSTRAINT "show_checklist_items_version_check" CHECK ("version" >= 1);

ALTER TABLE "show_checklists"
  ADD CONSTRAINT "show_checklists_archive_check"
  CHECK (("archivedAt" IS NULL) = ("archivedById" IS NULL));

ALTER TABLE "show_incidents"
  ADD CONSTRAINT "show_incidents_resolved_check"
  CHECK (("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "resolution" IS NOT NULL));

-- Incidents are a safety record: never deleted.
CREATE TRIGGER show_incidents_no_delete
  BEFORE DELETE ON "show_incidents"
  FOR EACH ROW EXECUTE FUNCTION production_record_append_only();
CREATE TRIGGER show_checklist_items_no_delete
  BEFORE DELETE ON "show_checklist_items"
  FOR EACH ROW EXECUTE FUNCTION production_record_append_only();
