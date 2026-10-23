-- CreateEnum
CREATE TYPE "ChangeOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "project_change_orders" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "scopeImpact" TEXT,
    "scheduleImpact" TEXT,
    "scheduleImpactDays" INTEGER,
    "status" "ChangeOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "costDeltaMinor" BIGINT NOT NULL DEFAULT 0,
    "revenueDeltaMinor" BIGINT NOT NULL DEFAULT 0,
    "clientApprovedOn" DATE,
    "clientApprovedByName" TEXT,
    "clientApprovalMethod" "AcceptanceMethod",
    "clientApprovalReference" TEXT,
    "statusComment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "selfApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_change_order_lines" (
    "id" UUID NOT NULL,
    "changeOrderId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "budgetLineId" UUID,
    "newCategory" "LineCategory",
    "newDescription" TEXT,
    "newCostCodeId" UUID,
    "costDeltaMinor" BIGINT NOT NULL,
    "revenueDeltaMinor" BIGINT NOT NULL,
    "note" TEXT,

    CONSTRAINT "project_change_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_budget_versions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "changeOrderId" UUID,
    "costMinor" BIGINT NOT NULL,
    "revenueMinor" BIGINT NOT NULL,
    "createdById" UUID,
    "createdByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_budget_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_change_orders_status_idx" ON "project_change_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "project_change_orders_projectId_number_key" ON "project_change_orders"("projectId", "number");

-- CreateIndex
CREATE INDEX "project_change_order_lines_budgetLineId_idx" ON "project_change_order_lines"("budgetLineId");

-- CreateIndex
CREATE UNIQUE INDEX "project_change_order_lines_changeOrderId_position_key" ON "project_change_order_lines"("changeOrderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "project_budget_versions_changeOrderId_key" ON "project_budget_versions"("changeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "project_budget_versions_projectId_version_key" ON "project_budget_versions"("projectId", "version");

-- AddForeignKey
ALTER TABLE "project_change_orders" ADD CONSTRAINT "project_change_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_orders" ADD CONSTRAINT "project_change_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_order_lines" ADD CONSTRAINT "project_change_order_lines_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "project_change_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_order_lines" ADD CONSTRAINT "project_change_order_lines_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "project_budget_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budget_versions" ADD CONSTRAINT "project_budget_versions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budget_versions" ADD CONSTRAINT "project_budget_versions_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "project_change_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written: invariants Prisma can't express (docs/change-control.md).
ALTER TABLE "project_change_order_lines" ADD CONSTRAINT "project_change_order_lines_target_check"
  CHECK ("budgetLineId" IS NOT NULL OR ("newCategory" IS NOT NULL AND "newDescription" IS NOT NULL));
ALTER TABLE "project_change_orders" ADD CONSTRAINT "project_change_orders_client_check"
  CHECK (status <> 'APPROVED' OR "revenueDeltaMinor" = 0 OR
         ("clientApprovedOn" IS NOT NULL AND "clientApprovedByName" IS NOT NULL AND "clientApprovalMethod" IS NOT NULL));

-- Version 1 of every fixed budget is its original.
INSERT INTO "project_budget_versions" ("id", "projectId", "version", "costMinor", "revenueMinor", "createdByLabel", "createdAt")
SELECT gen_random_uuid(), p.id, 1, p."budgetCostMinor", p."contractValueMinor", 'System', p."baselineLockedAt"
FROM "projects" p WHERE p."baselineLockedAt" IS NOT NULL;

-- A change order's lines are fixed once it leaves draft. Approval may only
-- fill in the budget line it created for a new line.
CREATE OR REPLACE FUNCTION project_change_order_lines_frozen() RETURNS trigger AS $$
DECLARE
  co_status "ChangeOrderStatus";
BEGIN
  SELECT status INTO co_status FROM project_change_orders
   WHERE id = COALESCE(NEW."changeOrderId", OLD."changeOrderId");
  IF co_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND co_status = 'SUBMITTED' AND OLD."budgetLineId" IS NULL
     AND (to_jsonb(NEW) - 'budgetLineId') = (to_jsonb(OLD) - 'budgetLineId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'change order lines can only change while the change order is a draft'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_change_order_lines_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "project_change_order_lines"
  FOR EACH ROW EXECUTE FUNCTION project_change_order_lines_frozen();
