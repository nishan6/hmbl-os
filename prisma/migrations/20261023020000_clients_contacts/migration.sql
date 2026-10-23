-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ClientRelationship" AS ENUM ('PROSPECT', 'CLIENT');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "legalName" TEXT,
    "kind" "ClientKind" NOT NULL DEFAULT 'COMPANY',
    "relationship" "ClientRelationship" NOT NULL DEFAULT 'PROSPECT',
    "industry" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "taxIdType" TEXT,
    "taxId" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "ownerId" UUID,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_normalizedName_idx" ON "clients"("normalizedName");

-- CreateIndex
CREATE INDEX "clients_status_name_idx" ON "clients"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tax_id_key" ON "clients"("taxIdType", "taxId") WHERE ("taxId" IS NOT NULL AND status = 'ACTIVE');

-- CreateIndex
CREATE INDEX "contacts_clientId_idx" ON "contacts"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_one_primary_key" ON "contacts"("clientId") WHERE ("isPrimary" AND status = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: canonical codes and no self-merge.
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_country_code_format" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "clients_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "clients_not_merged_into_self" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id"),
  ADD CONSTRAINT "clients_merged_are_archived" CHECK ("mergedIntoId" IS NULL OR "status" = 'ARCHIVED');
