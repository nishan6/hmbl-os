-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('CREW', 'EQUIPMENT');

-- CreateTable
CREATE TABLE "project_resource_requirements" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "budgetLineId" UUID,
    "dayRateMinor" BIGINT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_resource_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_resource_requirements_projectId_kind_idx" ON "project_resource_requirements"("projectId", "kind");

-- AddForeignKey
ALTER TABLE "project_resource_requirements" ADD CONSTRAINT "project_resource_requirements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_resource_requirements" ADD CONSTRAINT "project_resource_requirements_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "project_budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_resource_requirements" ADD CONSTRAINT "project_resource_requirements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At least one, dates in order, no negative rates.
ALTER TABLE "project_resource_requirements" ADD CONSTRAINT "project_resource_requirements_check"
  CHECK ("quantity" > 0 AND "endDate" >= "startDate" AND ("dayRateMinor" IS NULL OR "dayRateMinor" >= 0));
