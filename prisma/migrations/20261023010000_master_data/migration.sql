-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "PaymentTrigger" AS ENUM ('ON_ACCEPTANCE', 'BEFORE_START', 'ON_DELIVERY', 'AFTER_DELIVERY');

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "treatment" "TaxTreatment" NOT NULL DEFAULT 'STANDARD',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_term_instalments" (
    "id" UUID NOT NULL,
    "paymentTermId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "percentBps" INTEGER NOT NULL,
    "trigger" "PaymentTrigger" NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_term_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_countryCode_code_key" ON "tax_rates"("countryCode", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_one_default_per_country_key" ON "tax_rates"("countryCode") WHERE ("isDefault" AND status = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_code_key" ON "payment_terms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_one_default_key" ON "payment_terms"("isDefault") WHERE ("isDefault" AND status = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "payment_term_instalments_paymentTermId_position_key" ON "payment_term_instalments"("paymentTermId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- AddForeignKey
ALTER TABLE "payment_term_instalments" ADD CONSTRAINT "payment_term_instalments_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "payment_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: value ranges Prisma can't express.
ALTER TABLE "tax_rates"
  ADD CONSTRAINT "tax_rates_country_code_format" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "tax_rates_rate_range" CHECK ("rateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "tax_rates_non_standard_is_zero" CHECK ("treatment" = 'STANDARD' OR "rateBps" = 0);
ALTER TABLE "payment_term_instalments"
  ADD CONSTRAINT "payment_term_instalments_percent_range" CHECK ("percentBps" > 0 AND "percentBps" <= 10000),
  ADD CONSTRAINT "payment_term_instalments_days_range" CHECK ("days" BETWEEN 0 AND 365);
