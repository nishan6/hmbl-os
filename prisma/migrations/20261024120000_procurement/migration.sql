-- CreateEnum
CREATE TYPE "PurchaseOrderKind" AS ENUM ('SERVICES', 'RENTAL', 'CONSUMABLES', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'AMENDING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptKind" AS ENUM ('RECEIVED', 'RETURNED');

-- AlterTable
ALTER TABLE "vendor_bill_lines" ADD COLUMN     "purchaseOrderLineId" UUID;

-- CreateTable
CREATE TABLE "procurement_settings" (
    "legalEntityId" UUID NOT NULL,
    "approvalThresholdMinor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_settings_pkey" PRIMARY KEY ("legalEntityId")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT,
    "kind" "PurchaseOrderKind" NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "vendorId" UUID NOT NULL,
    "projectId" UUID,
    "costCentreId" UUID,
    "currency" CHAR(3) NOT NULL,
    "supplyType" "SupplyType" NOT NULL,
    "requiredDate" DATE,
    "hireFrom" DATE,
    "hireTo" DATE,
    "deliveryLocationId" UUID,
    "deliveryNotes" TEXT,
    "terms" TEXT,
    "notes" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "approvedSubtotalMinor" BIGINT,
    "amendmentReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "rejectedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "taxRateId" UUID,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "budgetLineId" UUID,
    "commitmentId" UUID,
    "receivedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returnedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_revisions" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "subtotalMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "approvedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "kind" "GoodsReceiptKind" NOT NULL,
    "receivedOn" DATE NOT NULL,
    "locationId" UUID,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_legalEntityId_status_idx" ON "purchase_orders"("legalEntityId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_vendorId_idx" ON "purchase_orders"("vendorId");

-- CreateIndex
CREATE INDEX "purchase_orders_projectId_idx" ON "purchase_orders"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_legalEntityId_number_key" ON "purchase_orders"("legalEntityId", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_revisions_purchaseOrderId_revision_key" ON "purchase_order_revisions"("purchaseOrderId", "revision");

-- CreateIndex
CREATE INDEX "goods_receipts_purchaseOrderId_idx" ON "goods_receipts"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_lineId_idx" ON "goods_receipt_lines"("lineId");

-- CreateIndex
CREATE INDEX "vendor_bill_lines_purchaseOrderLineId_idx" ON "vendor_bill_lines"("purchaseOrderLineId");

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_settings" ADD CONSTRAINT "procurement_settings_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_deliveryLocationId_fkey" FOREIGN KEY ("deliveryLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "project_budget_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Checks
ALTER TABLE "procurement_settings" ADD CONSTRAINT "procurement_settings_threshold_check" CHECK ("approvalThresholdMinor" >= 0);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_target_check" CHECK (("projectId" IS NULL) <> ("costCentreId" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_hire_check" CHECK ("hireFrom" IS NULL OR "hireTo" IS NULL OR "hireTo" >= "hireFrom");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_number_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'CANCELLED') OR "number" IS NOT NULL);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_quantities_check" CHECK ("quantity" > 0 AND "unitPriceMinor" >= 0 AND "receivedQuantity" >= 0 AND "returnedQuantity" >= 0 AND "returnedQuantity" <= "receivedQuantity");
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_quantity_check" CHECK ("quantity" > 0);
