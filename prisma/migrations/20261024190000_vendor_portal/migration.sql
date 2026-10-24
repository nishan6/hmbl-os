-- CreateEnum
CREATE TYPE "PortalOrderAnswer" AS ENUM ('CONFIRMED', 'DECLINED');

-- CreateTable
CREATE TABLE "purchase_order_vendor_responses" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "answer" "PortalOrderAnswer" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_vendor_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_bill_submissions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "vendorInvoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "note" TEXT,
    "documentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_bill_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_assignment_responses" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "answer" "PortalOrderAnswer" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_assignment_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_details_requests" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "vendorId" UUID,
    "crewMemberId" UUID,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_details_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_vendor_responses_purchaseOrderId_revision_key" ON "purchase_order_vendor_responses"("purchaseOrderId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "portal_bill_submissions_documentId_key" ON "portal_bill_submissions"("documentId");

-- CreateIndex
CREATE INDEX "portal_bill_submissions_purchaseOrderId_idx" ON "portal_bill_submissions"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_bill_submissions_vendorId_vendorInvoiceNumber_key" ON "portal_bill_submissions"("vendorId", "vendorInvoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "crew_assignment_responses_assignmentId_key" ON "crew_assignment_responses"("assignmentId");

-- CreateIndex
CREATE INDEX "portal_details_requests_vendorId_idx" ON "portal_details_requests"("vendorId");

-- CreateIndex
CREATE INDEX "portal_details_requests_crewMemberId_idx" ON "portal_details_requests"("crewMemberId");

-- AddForeignKey
ALTER TABLE "purchase_order_vendor_responses" ADD CONSTRAINT "purchase_order_vendor_responses_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_vendor_responses" ADD CONSTRAINT "purchase_order_vendor_responses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_bill_submissions" ADD CONSTRAINT "portal_bill_submissions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_bill_submissions" ADD CONSTRAINT "portal_bill_submissions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_bill_submissions" ADD CONSTRAINT "portal_bill_submissions_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_bill_submissions" ADD CONSTRAINT "portal_bill_submissions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignment_responses" ADD CONSTRAINT "crew_assignment_responses_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "crew_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignment_responses" ADD CONSTRAINT "crew_assignment_responses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_details_requests" ADD CONSTRAINT "portal_details_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_details_requests" ADD CONSTRAINT "portal_details_requests_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_details_requests" ADD CONSTRAINT "portal_details_requests_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A details request is for exactly one vendor or freelancer.
ALTER TABLE "portal_details_requests" ADD CONSTRAINT "portal_details_requests_one_org"
  CHECK (num_nonnulls("vendorId", "crewMemberId") = 1);

-- Every answer and upload belongs to the portal account's own organisation.
CREATE FUNCTION portal_vendor_record_guard() RETURNS trigger AS $$
DECLARE
  acct RECORD;
  owner UUID;
BEGIN
  SELECT "kind", "vendorId", "crewMemberId" INTO acct FROM "portal_accounts" WHERE "id" = NEW."accountId";
  IF TG_TABLE_NAME = 'purchase_order_vendor_responses' THEN
    SELECT "vendorId" INTO owner FROM "purchase_orders" WHERE "id" = NEW."purchaseOrderId";
    IF acct."kind" <> 'VENDOR' OR owner IS DISTINCT FROM acct."vendorId" THEN
      RAISE EXCEPTION 'Only the order''s vendor can answer it' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'portal_bill_submissions' THEN
    SELECT "vendorId" INTO owner FROM "purchase_orders" WHERE "id" = NEW."purchaseOrderId";
    IF acct."kind" <> 'VENDOR' OR NEW."vendorId" IS DISTINCT FROM acct."vendorId"
       OR owner IS DISTINCT FROM acct."vendorId" THEN
      RAISE EXCEPTION 'Only the order''s vendor can upload invoices for it' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'crew_assignment_responses' THEN
    SELECT "crewMemberId" INTO owner FROM "crew_assignments" WHERE "id" = NEW."assignmentId";
    IF acct."kind" <> 'FREELANCER' OR owner IS DISTINCT FROM acct."crewMemberId" THEN
      RAISE EXCEPTION 'Only the booked freelancer can answer a booking' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."vendorId" IS DISTINCT FROM acct."vendorId"
       OR NEW."crewMemberId" IS DISTINCT FROM acct."crewMemberId" THEN
      RAISE EXCEPTION 'A details request is for the account''s own record' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_order_vendor_responses_guard
  BEFORE INSERT ON "purchase_order_vendor_responses"
  FOR EACH ROW EXECUTE FUNCTION portal_vendor_record_guard();
CREATE TRIGGER portal_bill_submissions_guard
  BEFORE INSERT ON "portal_bill_submissions"
  FOR EACH ROW EXECUTE FUNCTION portal_vendor_record_guard();
CREATE TRIGGER crew_assignment_responses_guard
  BEFORE INSERT ON "crew_assignment_responses"
  FOR EACH ROW EXECUTE FUNCTION portal_vendor_record_guard();
CREATE TRIGGER portal_details_requests_guard
  BEFORE INSERT ON "portal_details_requests"
  FOR EACH ROW EXECUTE FUNCTION portal_vendor_record_guard();

CREATE TRIGGER purchase_order_vendor_responses_append_only
  BEFORE UPDATE OR DELETE ON "purchase_order_vendor_responses"
  FOR EACH ROW EXECUTE FUNCTION portal_evidence_append_only();
CREATE TRIGGER portal_bill_submissions_append_only
  BEFORE UPDATE OR DELETE ON "portal_bill_submissions"
  FOR EACH ROW EXECUTE FUNCTION portal_evidence_append_only();
CREATE TRIGGER crew_assignment_responses_append_only
  BEFORE UPDATE OR DELETE ON "crew_assignment_responses"
  FOR EACH ROW EXECUTE FUNCTION portal_evidence_append_only();
CREATE TRIGGER portal_details_requests_append_only
  BEFORE UPDATE OR DELETE ON "portal_details_requests"
  FOR EACH ROW EXECUTE FUNCTION portal_evidence_append_only();
