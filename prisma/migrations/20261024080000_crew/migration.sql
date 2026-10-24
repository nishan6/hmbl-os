-- CreateEnum
CREATE TYPE "CrewKind" AS ENUM ('EMPLOYEE', 'FREELANCER');

-- CreateEnum
CREATE TYPE "CrewRateType" AS ENUM ('DAY', 'HALF_DAY', 'OVERTIME_HOUR');

-- CreateTable
CREATE TABLE "crew_members" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" "CrewKind" NOT NULL,
    "userId" UUID,
    "vendorId" UUID,
    "email" TEXT,
    "phone" TEXT,
    "baseCity" TEXT,
    "preferredLocations" TEXT,
    "skills" TEXT[],
    "contractRef" TEXT,
    "notes" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelation" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_rates" (
    "id" UUID NOT NULL,
    "crewMemberId" UUID NOT NULL,
    "role" TEXT,
    "type" "CrewRateType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_certifications" (
    "id" UUID NOT NULL,
    "crewMemberId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "reference" TEXT,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_unavailability" (
    "id" UUID NOT NULL,
    "crewMemberId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_unavailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crew_members_userId_key" ON "crew_members"("userId");

-- CreateIndex
CREATE INDEX "crew_members_normalizedName_idx" ON "crew_members"("normalizedName");

-- CreateIndex
CREATE INDEX "crew_members_status_name_idx" ON "crew_members"("status", "name");

-- CreateIndex
CREATE INDEX "crew_rates_crewMemberId_idx" ON "crew_rates"("crewMemberId");

-- CreateIndex
CREATE INDEX "crew_certifications_crewMemberId_idx" ON "crew_certifications"("crewMemberId");

-- CreateIndex
CREATE INDEX "crew_unavailability_crewMemberId_startDate_idx" ON "crew_unavailability"("crewMemberId", "startDate");

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_rates" ADD CONSTRAINT "crew_rates_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_certifications" ADD CONSTRAINT "crew_certifications_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_unavailability" ADD CONSTRAINT "crew_unavailability_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rates are positive and end after they start; time off ends on or after it starts.
ALTER TABLE "crew_rates" ADD CONSTRAINT "crew_rates_check"
  CHECK ("amountMinor" > 0 AND ("validTo" IS NULL OR "validTo" >= "validFrom"));
ALTER TABLE "crew_unavailability" ADD CONSTRAINT "crew_unavailability_check"
  CHECK ("endDate" >= "startDate");
-- Staff have a user, not a vendor; only freelancers are paid through a vendor.
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_kind_check"
  CHECK (("kind" = 'EMPLOYEE' AND "vendorId" IS NULL) OR ("kind" = 'FREELANCER' AND "userId" IS NULL));
