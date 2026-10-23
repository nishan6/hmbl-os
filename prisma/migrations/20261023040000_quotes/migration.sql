-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PricingMethod" AS ENUM ('UNIT_RATE', 'FIXED', 'COST_PLUS_MARKUP', 'COST_PLUS_MARGIN');

-- CreateEnum
CREATE TYPE "LineCategory" AS ENUM ('CREW', 'EQUIPMENT', 'RENTAL', 'SERVICES', 'PRODUCTION', 'TRAVEL', 'LOGISTICS', 'FEES', 'OTHER');

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "opportunityId" UUID,
    "title" TEXT NOT NULL,
    "ownerId" UUID,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "contactId" UUID,
    "currency" CHAR(3) NOT NULL,
    "fxRateToBase" DECIMAL(18,8),
    "fxNote" TEXT,
    "validUntil" DATE NOT NULL,
    "paymentTermId" UUID,
    "paymentTermName" TEXT,
    "paymentSchedule" JSONB NOT NULL DEFAULT '[]',
    "taxRateId" UUID,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "contingencyBps" INTEGER NOT NULL DEFAULT 0,
    "poRequired" BOOLEAN NOT NULL DEFAULT false,
    "eventStartDate" DATE,
    "eventEndDate" DATE,
    "venue" TEXT,
    "scope" TEXT,
    "deliverables" TEXT,
    "exclusions" TEXT,
    "terms" TEXT,
    "internalNotes" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "contingencyMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "costMinor" BIGINT NOT NULL DEFAULT 0,
    "marginBps" INTEGER,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "section" TEXT,
    "category" "LineCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "method" "PricingMethod" NOT NULL DEFAULT 'UNIT_RATE',
    "quantity" DECIMAL(12,3) NOT NULL,
    "days" DECIMAL(12,3) NOT NULL,
    "unitId" UUID,
    "unitCode" TEXT,
    "unitCostMinor" BIGINT NOT NULL DEFAULT 0,
    "unitPriceMinor" BIGINT NOT NULL DEFAULT 0,
    "markupBps" INTEGER,
    "marginBps" INTEGER,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "taxRateId" UUID,
    "taxCode" TEXT,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "costMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_clientId_idx" ON "quotes"("clientId");

-- CreateIndex
CREATE INDEX "quotes_opportunityId_idx" ON "quotes"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_legalEntityId_number_key" ON "quotes"("legalEntityId", "number");

-- CreateIndex
CREATE INDEX "quote_versions_status_idx" ON "quote_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_quoteId_version_key" ON "quote_versions"("quoteId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "quote_lines_versionId_position_key" ON "quote_lines"("versionId", "position");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: value ranges.
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "quote_versions_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "quote_versions_fx_positive" CHECK ("fxRateToBase" IS NULL OR "fxRateToBase" > 0),
  ADD CONSTRAINT "quote_versions_tax_range" CHECK ("taxRateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "quote_versions_contingency_range" CHECK ("contingencyBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "quote_versions_event_dates_order" CHECK ("eventEndDate" IS NULL OR "eventStartDate" IS NULL OR "eventEndDate" >= "eventStartDate");
ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_quantity_positive" CHECK ("quantity" > 0 AND "days" > 0),
  ADD CONSTRAINT "quote_lines_amounts_not_negative" CHECK ("unitCostMinor" >= 0 AND "unitPriceMinor" >= 0),
  ADD CONSTRAINT "quote_lines_discount_range" CHECK ("discountBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "quote_lines_tax_range" CHECK ("taxRateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "quote_lines_markup_range" CHECK ("markupBps" IS NULL OR "markupBps" BETWEEN 0 AND 100000),
  -- A 100% margin would need an infinite price.
  ADD CONSTRAINT "quote_lines_margin_range" CHECK ("marginBps" IS NULL OR ("marginBps" >= 0 AND "marginBps" < 10000));

-- Hand-written: a version is frozen once it leaves draft. Only its status and
-- timestamps may change after that, and its lines can't change at all.
CREATE FUNCTION quote_version_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND
     (to_jsonb(NEW) - ARRAY['status', 'updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'updatedAt']) THEN
    RAISE EXCEPTION 'quote version % is % and can no longer be edited', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_versions_frozen BEFORE UPDATE ON "quote_versions"
  FOR EACH ROW EXECUTE FUNCTION quote_version_frozen();

CREATE FUNCTION quote_line_frozen() RETURNS trigger AS $$
DECLARE
  version_status "QuoteStatus";
BEGIN
  SELECT status INTO version_status FROM "quote_versions"
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."versionId" ELSE NEW."versionId" END;
  IF version_status <> 'DRAFT' OR (TG_OP = 'UPDATE' AND NEW."versionId" <> OLD."versionId") THEN
    RAISE EXCEPTION 'lines of a % quote version can no longer be changed', version_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON "quote_lines"
  FOR EACH ROW EXECUTE FUNCTION quote_line_frozen();
