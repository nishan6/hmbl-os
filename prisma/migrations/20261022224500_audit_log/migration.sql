-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'ANONYMOUS');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "legalEntityId" UUID,
    "changes" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_targetType_targetId_occurredAt_idx" ON "audit_events"("targetType", "targetId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_actorId_occurredAt_idx" ON "audit_events"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_legalEntityId_occurredAt_idx" ON "audit_events"("legalEntityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_occurredAt_idx" ON "audit_events"("occurredAt");


-- Hand-written: the audit log is append-only.
CREATE FUNCTION audit_events_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_reject_change();
