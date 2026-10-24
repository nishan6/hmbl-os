-- CreateEnum
CREATE TYPE "PeriodCloseAction" AS ENUM ('CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "period_close_events" (
    "id" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "action" "PeriodCloseAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "note" TEXT,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_close_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "period_close_events_periodId_createdAt_idx" ON "period_close_events"("periodId", "createdAt");

-- AddForeignKey
ALTER TABLE "period_close_events" ADD CONSTRAINT "period_close_events_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Close events are the audit evidence of a close: never changed or deleted.
CREATE OR REPLACE FUNCTION period_close_event_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'period close event % can''t be changed or deleted', OLD.id USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER period_close_event_guard
  BEFORE UPDATE OR DELETE ON "period_close_events"
  FOR EACH ROW EXECUTE FUNCTION period_close_event_guard();

-- A period's dates never change. Periods close in date order and reopen in
-- reverse: closing needs every earlier period of the entity closed, and
-- reopening needs every later one open. A closed period records who closed it.
CREATE OR REPLACE FUNCTION accounting_period_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'period % can''t be deleted', OLD.name USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."legalEntityId" <> OLD."legalEntityId" OR NEW."startDate" <> OLD."startDate"
     OR NEW."endDate" <> OLD."endDate" OR NEW."fiscalYear" <> OLD."fiscalYear" THEN
    RAISE EXCEPTION 'period % can''t be moved', OLD.name USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'CLOSED' AND (NEW."closedAt" IS NULL OR NEW."closedById" IS NULL) THEN
    RAISE EXCEPTION 'a closed period records who closed it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'OPEN' AND (NEW."closedAt" IS NOT NULL OR NEW."closedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'an open period has no closer' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'OPEN' AND NEW.status = 'CLOSED' AND EXISTS (
    SELECT 1 FROM accounting_periods
     WHERE "legalEntityId" = NEW."legalEntityId" AND "startDate" < NEW."startDate" AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'close the periods before % first', NEW.name USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'CLOSED' AND NEW.status = 'OPEN' AND EXISTS (
    SELECT 1 FROM accounting_periods
     WHERE "legalEntityId" = NEW."legalEntityId" AND "startDate" > NEW."startDate" AND status = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'reopen the periods after % first', NEW.name USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounting_period_guard
  BEFORE UPDATE OR DELETE ON "accounting_periods"
  FOR EACH ROW EXECUTE FUNCTION accounting_period_guard();
