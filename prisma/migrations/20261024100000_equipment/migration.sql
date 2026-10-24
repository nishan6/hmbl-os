-- CreateEnum
CREATE TYPE "EquipmentTracking" AS ENUM ('SERIALISED', 'QUANTITY');

-- CreateEnum
CREATE TYPE "EquipmentOwnership" AS ENUM ('OWNED', 'LEASED');

-- CreateEnum
CREATE TYPE "EquipmentAssetState" AS ENUM ('AVAILABLE', 'OUT_OF_SERVICE', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "EquipmentCondition" AS ENUM ('GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "EquipmentMaintenanceKind" AS ENUM ('SCHEDULED', 'FAULT', 'REPAIR', 'INSPECTION');

-- CreateEnum
CREATE TYPE "EquipmentMaintenanceStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EquipmentStockMovementKind" AS ENUM ('ADDED', 'REMOVED', 'TRANSFERRED', 'OUT_OF_SERVICE', 'RETURNED_TO_SERVICE');

-- CreateTable
CREATE TABLE "equipment_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "inspectionIntervalDays" INTEGER,
    "inspectionChecklist" TEXT[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_items" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "tracking" "EquipmentTracking" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "description" TEXT,
    "currency" CHAR(3) NOT NULL,
    "rentalDayRateMinor" BIGINT,
    "internalDayCostMinor" BIGINT,
    "replacementValueMinor" BIGINT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_assets" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "assetTag" TEXT NOT NULL,
    "serialNumber" TEXT,
    "ownership" "EquipmentOwnership" NOT NULL DEFAULT 'OWNED',
    "legalEntityId" UUID,
    "locationId" UUID,
    "state" "EquipmentAssetState" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "EquipmentCondition" NOT NULL DEFAULT 'GOOD',
    "stateReason" TEXT,
    "purchasedOn" DATE,
    "purchaseCostMinor" BIGINT,
    "purchaseCurrency" CHAR(3),
    "purchasedFromId" UUID,
    "purchaseReference" TEXT,
    "warrantyUntil" DATE,
    "lastInspectedOn" DATE,
    "nextInspectionDue" DATE,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_stock" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "outOfServiceQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_stock_movements" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "kind" "EquipmentStockMovementKind" NOT NULL,
    "quantityChange" INTEGER NOT NULL DEFAULT 0,
    "outOfServiceChange" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "maintenanceId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_kits" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_kit_components" (
    "id" UUID NOT NULL,
    "kitId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "equipment_kit_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_maintenance" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "assetId" UUID,
    "locationId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "kind" "EquipmentMaintenanceKind" NOT NULL,
    "status" "EquipmentMaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "details" TEXT,
    "takesOutOfService" BOOLEAN NOT NULL DEFAULT false,
    "blockFrom" DATE,
    "blockTo" DATE,
    "checklist" JSONB,
    "passed" BOOLEAN,
    "outcome" TEXT,
    "costMinor" BIGINT,
    "currency" CHAR(3),
    "vendorId" UUID,
    "reportedById" UUID NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "returnedToServiceById" UUID,
    "returnedToServiceAt" TIMESTAMP(3),

    CONSTRAINT "equipment_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_categories_name_key" ON "equipment_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_items_sku_key" ON "equipment_items"("sku");

-- CreateIndex
CREATE INDEX "equipment_items_categoryId_idx" ON "equipment_items"("categoryId");

-- CreateIndex
CREATE INDEX "equipment_items_status_name_idx" ON "equipment_items"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_assets_assetTag_key" ON "equipment_assets"("assetTag");

-- CreateIndex
CREATE INDEX "equipment_assets_itemId_state_idx" ON "equipment_assets"("itemId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_assets_itemId_serialNumber_key" ON "equipment_assets"("itemId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_stock_itemId_locationId_key" ON "equipment_stock"("itemId", "locationId");

-- CreateIndex
CREATE INDEX "equipment_stock_movements_itemId_createdAt_idx" ON "equipment_stock_movements"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_kits_code_key" ON "equipment_kits"("code");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_kit_components_kitId_itemId_key" ON "equipment_kit_components"("kitId", "itemId");

-- CreateIndex
CREATE INDEX "equipment_maintenance_assetId_status_idx" ON "equipment_maintenance"("assetId", "status");

-- CreateIndex
CREATE INDEX "equipment_maintenance_itemId_status_idx" ON "equipment_maintenance"("itemId", "status");

-- CreateIndex
CREATE INDEX "equipment_maintenance_status_kind_idx" ON "equipment_maintenance"("status", "kind");

-- AddForeignKey
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "equipment_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "equipment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_purchasedFromId_fkey" FOREIGN KEY ("purchasedFromId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_stock" ADD CONSTRAINT "equipment_stock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "equipment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_stock" ADD CONSTRAINT "equipment_stock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_stock_movements" ADD CONSTRAINT "equipment_stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "equipment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_stock_movements" ADD CONSTRAINT "equipment_stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_kit_components" ADD CONSTRAINT "equipment_kit_components_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "equipment_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_kit_components" ADD CONSTRAINT "equipment_kit_components_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "equipment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "equipment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "equipment_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Equipment rules the database keeps (docs/equipment.md).
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_amounts_check"
  CHECK (("rentalDayRateMinor" IS NULL OR "rentalDayRateMinor" >= 0)
     AND ("internalDayCostMinor" IS NULL OR "internalDayCostMinor" >= 0)
     AND ("replacementValueMinor" IS NULL OR "replacementValueMinor" >= 0));
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_interval_check"
  CHECK ("inspectionIntervalDays" IS NULL OR "inspectionIntervalDays" > 0);
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_purchase_check"
  CHECK (("purchaseCostMinor" IS NULL OR ("purchaseCostMinor" >= 0 AND "purchaseCurrency" IS NOT NULL)));
ALTER TABLE "equipment_stock" ADD CONSTRAINT "equipment_stock_quantity_check"
  CHECK ("quantity" >= 0 AND "outOfServiceQuantity" >= 0 AND "outOfServiceQuantity" <= "quantity");
ALTER TABLE "equipment_kit_components" ADD CONSTRAINT "equipment_kit_components_quantity_check"
  CHECK ("quantity" > 0);
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_check"
  CHECK ("quantity" > 0
     AND ("blockTo" IS NULL OR ("blockFrom" IS NOT NULL AND "blockTo" >= "blockFrom"))
     AND ("costMinor" IS NULL OR ("costMinor" >= 0 AND "currency" IS NOT NULL))
     AND ("assetId" IS NOT NULL OR "locationId" IS NOT NULL));
