-- CreateEnum
CREATE TYPE "ShipmentKind" AS ENUM ('EQUIPMENT', 'FREIGHT', 'LOCAL_TRANSFER');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'BOOKED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ShipmentKind" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "vendorId" UUID,
    "carrier" TEXT,
    "reference" TEXT,
    "vehicle" TEXT,
    "vehicleRegistration" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "pickupTimeZone" TEXT NOT NULL,
    "deliverBy" TIMESTAMP(3),
    "deliverTimeZone" TEXT,
    "packages" INTEGER,
    "weightKg" DECIMAL(10,2),
    "contents" TEXT,
    "currency" CHAR(3) NOT NULL,
    "costMinor" BIGINT NOT NULL DEFAULT 0,
    "budgetLineId" UUID,
    "commitmentId" UUID,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancellationFeeMinor" BIGINT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_equipment" (
    "shipmentId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,

    CONSTRAINT "shipment_equipment_pkey" PRIMARY KEY ("shipmentId","bookingId")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "note" TEXT,
    "fromCostMinor" BIGINT,
    "toCostMinor" BIGINT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_commitmentId_key" ON "shipments"("commitmentId");

-- CreateIndex
CREATE INDEX "shipments_projectId_idx" ON "shipments"("projectId");

-- CreateIndex
CREATE INDEX "shipments_legalEntityId_status_idx" ON "shipments"("legalEntityId", "status");

-- CreateIndex
CREATE INDEX "shipment_equipment_bookingId_idx" ON "shipment_equipment"("bookingId");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_idx" ON "shipment_events"("shipmentId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_equipment" ADD CONSTRAINT "shipment_equipment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_equipment" ADD CONSTRAINT "shipment_equipment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "equipment_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "shipments" ADD CONSTRAINT "shipments_cost_check"
  CHECK ("costMinor" >= 0 AND ("cancellationFeeMinor" IS NULL OR "cancellationFeeMinor" >= 0));
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_times_check"
  CHECK ("deliverBy" IS NULL OR "deliverBy" >= "pickupAt");

-- The tracking log is history: never edited or deleted.
CREATE OR REPLACE FUNCTION shipment_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'shipment events can''t be changed or deleted'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shipment_event_append_only
  BEFORE UPDATE OR DELETE ON "shipment_events"
  FOR EACH ROW EXECUTE FUNCTION shipment_event_append_only();
