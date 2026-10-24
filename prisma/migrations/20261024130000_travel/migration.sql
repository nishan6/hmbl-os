-- CreateEnum
CREATE TYPE "TravelRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TravelBookingKind" AS ENUM ('FLIGHT', 'RAIL', 'HOTEL', 'GROUND', 'OTHER');

-- CreateEnum
CREATE TYPE "TravelBookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TravelChangeKind" AS ENUM ('CHANGED', 'CANCELLED');

-- CreateTable
CREATE TABLE "travel_requests" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "status" "TravelRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "route" TEXT,
    "currency" CHAR(3) NOT NULL,
    "estimateMinor" BIGINT NOT NULL DEFAULT 0,
    "budgetLineId" UUID,
    "notes" TEXT,
    "rejectedReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_travellers" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "crewMemberId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "preferences" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "documentExpiry" DATE,
    "nationality" CHAR(2),
    "visaReference" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_travellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_bookings" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" "TravelBookingKind" NOT NULL,
    "status" "TravelBookingStatus" NOT NULL DEFAULT 'HELD',
    "vendorId" UUID,
    "provider" TEXT,
    "reference" TEXT,
    "serviceDetails" TEXT,
    "fromPlace" TEXT,
    "toPlace" TEXT,
    "departAt" TIMESTAMP(3),
    "departTimeZone" TEXT,
    "arriveAt" TIMESTAMP(3),
    "arriveTimeZone" TEXT,
    "checkIn" DATE,
    "checkOut" DATE,
    "rooms" INTEGER,
    "address" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "costMinor" BIGINT NOT NULL DEFAULT 0,
    "commitmentId" UUID,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancellationFeeMinor" BIGINT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_booking_travellers" (
    "bookingId" UUID NOT NULL,
    "travellerId" UUID NOT NULL,
    "room" TEXT,

    CONSTRAINT "travel_booking_travellers_pkey" PRIMARY KEY ("bookingId","travellerId")
);

-- CreateTable
CREATE TABLE "travel_booking_changes" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "kind" "TravelChangeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "fromCostMinor" BIGINT NOT NULL,
    "toCostMinor" BIGINT NOT NULL,
    "summary" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_booking_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travel_requests_projectId_idx" ON "travel_requests"("projectId");

-- CreateIndex
CREATE INDEX "travel_requests_legalEntityId_status_idx" ON "travel_requests"("legalEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "travel_requests_legalEntityId_number_key" ON "travel_requests"("legalEntityId", "number");

-- CreateIndex
CREATE INDEX "travel_travellers_crewMemberId_idx" ON "travel_travellers"("crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "travel_travellers_requestId_crewMemberId_key" ON "travel_travellers"("requestId", "crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "travel_bookings_commitmentId_key" ON "travel_bookings"("commitmentId");

-- CreateIndex
CREATE INDEX "travel_bookings_requestId_idx" ON "travel_bookings"("requestId");

-- CreateIndex
CREATE INDEX "travel_booking_travellers_travellerId_idx" ON "travel_booking_travellers"("travellerId");

-- CreateIndex
CREATE INDEX "travel_booking_changes_bookingId_idx" ON "travel_booking_changes"("bookingId");

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_travellers" ADD CONSTRAINT "travel_travellers_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "travel_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_travellers" ADD CONSTRAINT "travel_travellers_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "travel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_booking_travellers" ADD CONSTRAINT "travel_booking_travellers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_booking_travellers" ADD CONSTRAINT "travel_booking_travellers_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "travel_travellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_booking_changes" ADD CONSTRAINT "travel_booking_changes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A trip ends on or after it starts; a booking costs nothing negative.
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_dates_check" CHECK ("endDate" >= "startDate");
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_estimate_check" CHECK ("estimateMinor" >= 0);
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_cost_check"
  CHECK ("costMinor" >= 0 AND ("cancellationFeeMinor" IS NULL OR "cancellationFeeMinor" >= 0));
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_nights_check"
  CHECK ("checkIn" IS NULL OR "checkOut" IS NULL OR "checkOut" > "checkIn");
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_times_check"
  CHECK ("departAt" IS NULL OR "arriveAt" IS NULL OR "arriveAt" >= "departAt");

-- Booking changes are the history of what a booking cost: never edited or deleted.
CREATE OR REPLACE FUNCTION travel_booking_change_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'travel booking changes can''t be changed or deleted'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER travel_booking_change_append_only
  BEFORE UPDATE OR DELETE ON "travel_booking_changes"
  FOR EACH ROW EXECUTE FUNCTION travel_booking_change_append_only();
