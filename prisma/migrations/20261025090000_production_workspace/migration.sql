-- CreateEnum
CREATE TYPE "ShowUpdateStatus" AS ENUM ('INFO', 'ON_TRACK', 'DELAYED', 'ISSUE', 'DONE');

-- CreateTable
CREATE TABLE "run_of_show_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "title" TEXT NOT NULL,
    "owner" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_of_show_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sheets" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "revision" INTEGER NOT NULL,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "publishedById" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_notes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "archivedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_status_updates" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" "ShowUpdateStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "show_status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_of_show_items_projectId_day_startTime_idx" ON "run_of_show_items"("projectId", "day", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "call_sheets_projectId_day_revision_key" ON "call_sheets"("projectId", "day", "revision");

-- CreateIndex
CREATE INDEX "production_notes_projectId_createdAt_idx" ON "production_notes"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "show_status_updates_projectId_createdAt_idx" ON "show_status_updates"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "run_of_show_items" ADD CONSTRAINT "run_of_show_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sheets" ADD CONSTRAINT "call_sheets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_notes" ADD CONSTRAINT "production_notes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_status_updates" ADD CONSTRAINT "show_status_updates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: invariants Prisma can't express.

ALTER TABLE "run_of_show_items"
  ADD CONSTRAINT "run_of_show_items_time_check"
  CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "run_of_show_items_duration_check"
  CHECK ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 1 AND 1440);

ALTER TABLE "call_sheets"
  ADD CONSTRAINT "call_sheets_revision_check" CHECK ("revision" >= 1);

ALTER TABLE "production_notes"
  ADD CONSTRAINT "production_notes_archive_check"
  CHECK (("archivedAt" IS NULL) = ("archivedById" IS NULL));

-- Published call sheets and status updates are a record of what was said.
CREATE OR REPLACE FUNCTION production_record_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are never changed or deleted', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER call_sheets_append_only
  BEFORE UPDATE OR DELETE ON "call_sheets"
  FOR EACH ROW EXECUTE FUNCTION production_record_append_only();
CREATE TRIGGER show_status_updates_append_only
  BEFORE UPDATE OR DELETE ON "show_status_updates"
  FOR EACH ROW EXECUTE FUNCTION production_record_append_only();
