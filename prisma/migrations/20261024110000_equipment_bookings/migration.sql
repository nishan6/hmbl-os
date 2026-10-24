-- AlterEnum
ALTER TYPE "EquipmentStockMovementKind" ADD VALUE 'DISPATCHED';
ALTER TYPE "EquipmentStockMovementKind" ADD VALUE 'RETURNED';

-- CreateEnum
CREATE TYPE "EquipmentBookingStatus" AS ENUM ('RESERVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EquipmentBookingMovementKind" AS ENUM ('DISPATCHED', 'RETURNED');

-- CreateTable
CREATE TABLE "equipment_bookings" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID,
    "itemId" UUID NOT NULL,
    "kitId" UUID,
    "quantity" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "EquipmentBookingStatus" NOT NULL DEFAULT 'RESERVED',
    "dispatchedQuantity" INTEGER NOT NULL DEFAULT 0,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
    "lostQuantity" INTEGER NOT NULL DEFAULT 0,
    "shortfall" INTEGER NOT NULL DEFAULT 0,
    "overrideReason" TEXT,
    "overrideById" UUID,
    "notes" TEXT,
    "closedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_allocations" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedById" UUID,
    "returnedAt" TIMESTAMP(3),
    "returnedById" UUID,
    "returnCondition" "EquipmentCondition",
    "lost" BOOLEAN NOT NULL DEFAULT false,
    "returnNotes" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_booking_movements" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "kind" "EquipmentBookingMovementKind" NOT NULL,
    "locationId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_booking_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_bookings_itemId_startDate_idx" ON "equipment_bookings"("itemId", "startDate");

-- CreateIndex
CREATE INDEX "equipment_bookings_projectId_idx" ON "equipment_bookings"("projectId");

-- CreateIndex
CREATE INDEX "equipment_allocations_assetId_idx" ON "equipment_allocations"("assetId");

-- CreateIndex
CREATE INDEX "equipment_allocations_bookingId_idx" ON "equipment_allocations"("bookingId");

-- CreateIndex
CREATE INDEX "equipment_booking_movements_bookingId_idx" ON "equipment_booking_movements"("bookingId");

-- AddForeignKey
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "project_resource_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "equipment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "equipment_kits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "equipment_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "equipment_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_booking_movements" ADD CONSTRAINT "equipment_booking_movements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "equipment_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_booking_movements" ADD CONSTRAINT "equipment_booking_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Equipment booking rules the database keeps (docs/equipment.md).
ALTER TABLE "equipment_bookings" ADD CONSTRAINT "equipment_bookings_quantities_check"
  CHECK ("quantity" > 0 AND "endDate" >= "startDate"
     AND "dispatchedQuantity" >= 0 AND "returnedQuantity" >= 0
     AND "damagedQuantity" >= 0 AND "lostQuantity" >= 0 AND "shortfall" >= 0
     AND "returnedQuantity" + "damagedQuantity" + "lostQuantity" <= "dispatchedQuantity"
     AND "dispatchedQuantity" <= "quantity");
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_dates_check"
  CHECK ("endDate" >= "startDate");
ALTER TABLE "equipment_booking_movements" ADD CONSTRAINT "equipment_booking_movements_check"
  CHECK ("quantity" >= 0 AND "damaged" >= 0 AND "lost" >= 0);

-- One booking at a time per asset: no two allocations still holding the same
-- asset may share a day.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_no_overlap"
  EXCLUDE USING gist ("assetId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE ("releasedAt" IS NULL);
