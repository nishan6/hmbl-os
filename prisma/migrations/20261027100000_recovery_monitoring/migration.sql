-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "restore_checks" (
    "id" UUID NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "database" TEXT NOT NULL,
    "backupFile" TEXT NOT NULL,
    "backupTakenAt" TIMESTAMPTZ(3) NOT NULL,
    "backupBytes" BIGINT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "results" JSONB NOT NULL,

    CONSTRAINT "restore_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_errors" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "digest" TEXT,
    "method" TEXT NOT NULL,
    "routePath" TEXT NOT NULL,
    "routeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "app_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restore_checks_database_checkedAt_idx" ON "restore_checks"("database", "checkedAt");

-- CreateIndex
CREATE INDEX "app_errors_occurredAt_idx" ON "app_errors"("occurredAt");

-- CreateIndex
CREATE INDEX "app_errors_digest_idx" ON "app_errors"("digest");

-- CreateIndex
CREATE INDEX "job_runs_job_startedAt_idx" ON "job_runs"("job", "startedAt");


-- Hand-written: a restore check is evidence, so it is never changed or deleted.
CREATE FUNCTION restore_checks_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'restore_checks is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER restore_checks_append_only
  BEFORE UPDATE OR DELETE ON "restore_checks"
  FOR EACH ROW EXECUTE FUNCTION restore_checks_reject_change();
