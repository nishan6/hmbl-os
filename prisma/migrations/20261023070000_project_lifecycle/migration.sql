-- CreateEnum
CREATE TYPE "RevenueModel" AS ENUM ('FIXED_FEE', 'ITEMISED', 'DAY_RATE', 'RENTAL', 'RETAINER', 'COST_PLUS', 'INTERNAL');

-- AlterEnum
BEGIN;
CREATE TYPE "ProjectStatus_new" AS ENUM ('DRAFT', 'COMMERCIAL_REVIEW', 'APPROVED', 'PLANNING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'FINANCIAL_CLOSE', 'CLOSED', 'ON_HOLD', 'CANCELLED');
ALTER TABLE "public"."projects" ALTER COLUMN "status" DROP DEFAULT;
-- Hand-edited: ACTIVE projects came from accepted quotes, so they are Approved.
ALTER TABLE "projects" ALTER COLUMN "status" TYPE "ProjectStatus_new"
  USING ((CASE "status"::text WHEN 'ACTIVE' THEN 'APPROVED' ELSE "status"::text END)::"ProjectStatus_new");
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
DROP TYPE "public"."ProjectStatus_old";
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "businessUnitId" UUID,
ADD COLUMN     "deliverables" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "locations" TEXT,
ADD COLUMN     "producerId" UUID,
ADD COLUMN     "projectManagerId" UUID,
ADD COLUMN     "projectTypeId" UUID,
ADD COLUMN     "resumeStatus" "ProjectStatus",
ADD COLUMN     "revenueModel" "RevenueModel" NOT NULL DEFAULT 'ITEMISED',
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "clientId" DROP NOT NULL,
ALTER COLUMN "quoteId" DROP NOT NULL,
ALTER COLUMN "sourceQuoteVersionId" DROP NOT NULL,
ALTER COLUMN "contractValueMinor" SET DEFAULT 0,
ALTER COLUMN "taxMinor" SET DEFAULT 0,
ALTER COLUMN "totalMinor" SET DEFAULT 0,
ALTER COLUMN "budgetCostMinor" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "project_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultRevenueModel" "RevenueModel" NOT NULL DEFAULT 'ITEMISED',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_status_changes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fromStatus" "ProjectStatus",
    "toStatus" "ProjectStatus" NOT NULL,
    "reason" TEXT,
    "override" BOOLEAN NOT NULL DEFAULT false,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_types_code_key" ON "project_types"("code");

-- CreateIndex
CREATE INDEX "project_status_changes_projectId_at_idx" ON "project_status_changes"("projectId", "at");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "project_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_changes" ADD CONSTRAINT "project_status_changes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-written: invariants Prisma can't express.
ALTER TABLE "projects" ADD CONSTRAINT "projects_resume_status_check"
  CHECK ((status IN ('ON_HOLD', 'CANCELLED')) = ("resumeStatus" IS NOT NULL));
ALTER TABLE "projects" ADD CONSTRAINT "projects_quote_source_check"
  CHECK (("quoteId" IS NULL) = ("sourceQuoteVersionId" IS NULL));

-- Existing projects: start their history, and copy scope and deliverables
-- from the accepted quote version as new projects do.
INSERT INTO "project_status_changes" ("id", "projectId", "fromStatus", "toStatus", "reason", "actorLabel", "at")
SELECT gen_random_uuid(), p.id, NULL, p.status, 'Created from an accepted quote', 'System', p."createdAt"
FROM "projects" p;

UPDATE "projects" p SET "scope" = v.scope, "deliverables" = v.deliverables, "statusChangedAt" = p."createdAt"
FROM "quote_versions" v WHERE v.id = p."sourceQuoteVersionId";
