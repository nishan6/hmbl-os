-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "invoiceCode" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "serviceCode" TEXT;

-- CreateTable
CREATE TABLE "invoice_services" (
    "id" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_services_legalEntityId_code_key" ON "invoice_services"("legalEntityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_invoice_code_key" ON "clients"("invoiceCode") WHERE ("invoiceCode" IS NOT NULL AND status = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "invoice_services" ADD CONSTRAINT "invoice_services_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Codes appear in invoice numbers: capitals and digits only. INT is the code
-- one-off clients share, so no client may hold it.
ALTER TABLE "clients" ADD CONSTRAINT "clients_invoice_code_check"
  CHECK ("invoiceCode" IS NULL OR ("invoiceCode" ~ '^[A-Z0-9]{2,6}$' AND "invoiceCode" <> 'INT'));
ALTER TABLE "invoice_services" ADD CONSTRAINT "invoice_services_code_check"
  CHECK ("code" ~ '^[A-Z0-9]{2,6}$');

-- A service's code is printed in issued numbers, so it never changes.
CREATE OR REPLACE FUNCTION invoice_service_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice services are archived, not deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."code" <> OLD."code" OR NEW."legalEntityId" <> OLD."legalEntityId" THEN
    RAISE EXCEPTION 'an invoice service''s code can''t change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_service_guard
  BEFORE UPDATE OR DELETE ON "invoice_services"
  FOR EACH ROW EXECUTE FUNCTION invoice_service_guard();

-- Counters only move forward: going back would issue a number twice.
CREATE OR REPLACE FUNCTION number_counter_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'number counters can''t be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."lastValue" < OLD."lastValue" THEN
    RAISE EXCEPTION 'number counter %/% can''t go back from % to %',
      OLD."schemeId", OLD."periodKey", OLD."lastValue", NEW."lastValue"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER number_counter_guard
  BEFORE UPDATE OR DELETE ON "number_counters"
  FOR EACH ROW EXECUTE FUNCTION number_counter_guard();
