-- CreateEnum
CREATE TYPE "OpeningBalanceStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "OpeningItemKind" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "openingItemId" UUID;

-- AlterTable
ALTER TABLE "vendor_bills" ADD COLUMN     "openingItemId" UUID;

-- CreateTable
CREATE TABLE "opening_balances" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "cutOverDate" DATE NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "status" "OpeningBalanceStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceDebitMinor" BIGINT,
    "sourceReceivablesMinor" BIGINT,
    "sourcePayablesMinor" BIGINT,
    "sourceInvoiceCount" INTEGER,
    "sourceBillCount" INTEGER,
    "notes" TEXT,
    "journalId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_account_lines" (
    "id" UUID NOT NULL,
    "openingId" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "debitMinor" BIGINT NOT NULL DEFAULT 0,
    "creditMinor" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "opening_account_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_items" (
    "id" UUID NOT NULL,
    "openingId" UUID NOT NULL,
    "kind" "OpeningItemKind" NOT NULL,
    "line" INTEGER NOT NULL,
    "clientId" UUID,
    "vendorId" UUID,
    "reference" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "fxRate" DECIMAL(18,8),
    "baseAmountMinor" BIGINT NOT NULL,

    CONSTRAINT "opening_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opening_balances_legalEntityId_key" ON "opening_balances"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balances_journalId_key" ON "opening_balances"("journalId");

-- CreateIndex
CREATE UNIQUE INDEX "opening_account_lines_openingId_accountId_key" ON "opening_account_lines"("openingId", "accountId");

-- CreateIndex
CREATE INDEX "opening_items_clientId_idx" ON "opening_items"("clientId");

-- CreateIndex
CREATE INDEX "opening_items_vendorId_idx" ON "opening_items"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "opening_items_openingId_kind_line_key" ON "opening_items"("openingId", "kind", "line");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_openingItemId_key" ON "sales_invoices"("openingItemId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_openingItemId_key" ON "vendor_bills"("openingItemId");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_openingItemId_fkey" FOREIGN KEY ("openingItemId") REFERENCES "opening_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_openingItemId_fkey" FOREIGN KEY ("openingItemId") REFERENCES "opening_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_account_lines" ADD CONSTRAINT "opening_account_lines_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "opening_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_account_lines" ADD CONSTRAINT "opening_account_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_items" ADD CONSTRAINT "opening_items_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "opening_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_items" ADD CONSTRAINT "opening_items_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_items" ADD CONSTRAINT "opening_items_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

