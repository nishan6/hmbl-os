-- CreateEnum
CREATE TYPE "QuoteApprovalAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuedById" UUID,
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "commercial_settings" (
    "legalEntityId" UUID NOT NULL,
    "requireQuoteApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalThresholdMinor" BIGINT,
    "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_settings_pkey" PRIMARY KEY ("legalEntityId")
);

-- CreateTable
CREATE TABLE "quote_approval_steps" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "action" "QuoteApprovalAction" NOT NULL,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "comment" TEXT,
    "selfApproval" BOOLEAN NOT NULL DEFAULT false,
    "totalMinor" BIGINT NOT NULL,
    "marginBps" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_approval_steps_versionId_at_idx" ON "quote_approval_steps"("versionId", "at");

-- AddForeignKey
ALTER TABLE "commercial_settings" ADD CONSTRAINT "commercial_settings_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_approval_steps" ADD CONSTRAINT "quote_approval_steps_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_approval_steps" ADD CONSTRAINT "quote_approval_steps_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: value ranges.
ALTER TABLE "commercial_settings"
  ADD CONSTRAINT "commercial_settings_threshold_not_negative" CHECK ("approvalThresholdMinor" IS NULL OR "approvalThresholdMinor" >= 0),
  ADD CONSTRAINT "commercial_settings_validity_range" CHECK ("quoteValidityDays" BETWEEN 1 AND 365);

-- Hand-written: the workflow columns may change after a version leaves draft;
-- nothing else may.
CREATE OR REPLACE FUNCTION quote_version_frozen() RETURNS trigger AS $$
DECLARE
  workflow text[] := ARRAY['status', 'updatedAt', 'submittedAt', 'approvedAt', 'approvedById',
                           'issuedAt', 'issuedById', 'withdrawnAt', 'statusReason'];
BEGIN
  IF OLD.status <> 'DRAFT' AND
     (to_jsonb(NEW) - workflow) IS DISTINCT FROM (to_jsonb(OLD) - workflow) THEN
    RAISE EXCEPTION 'quote version % is % and can no longer be edited', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Hand-written: Sales now issues quotes itself (no approval by default,
-- decided 2026-10-23). Adds the permission to the existing system role.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT "id", 'commercial.issue' FROM "roles" WHERE "key" = 'sales' AND "isSystem"
ON CONFLICT DO NOTHING;
