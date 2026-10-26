-- CreateEnum
CREATE TYPE "ReadinessSource" AS ENUM ('COMMAND', 'APP');

-- CreateTable
CREATE TABLE "readiness_runs" (
    "id" UUID NOT NULL,
    "ranAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ReadinessSource" NOT NULL,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "appEnv" TEXT NOT NULL,
    "database" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "passCount" INTEGER NOT NULL,
    "warnCount" INTEGER NOT NULL,
    "failCount" INTEGER NOT NULL,
    "results" JSONB NOT NULL,

    CONSTRAINT "readiness_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "readiness_runs_ranAt_idx" ON "readiness_runs"("ranAt");


-- Hand-written: a readiness run is evidence, so it is never changed or deleted.
CREATE FUNCTION readiness_runs_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'readiness_runs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER readiness_runs_append_only
  BEFORE UPDATE OR DELETE ON "readiness_runs"
  FOR EACH ROW EXECUTE FUNCTION readiness_runs_reject_change();
