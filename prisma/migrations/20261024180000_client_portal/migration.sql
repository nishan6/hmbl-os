-- CreateEnum
CREATE TYPE "PortalShareKind" AS ENUM ('PROJECT', 'QUOTE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "PortalResponse" AS ENUM ('ACCEPTED', 'DECLINED');

-- AlterEnum
ALTER TYPE "AcceptanceMethod" ADD VALUE 'PORTAL';

-- CreateTable
CREATE TABLE "portal_shares" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" "PortalShareKind" NOT NULL,
    "projectId" UUID,
    "quoteId" UUID,
    "documentId" UUID,
    "sharedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "portal_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_portal_responses" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "response" "PortalResponse" NOT NULL,
    "typedName" TEXT NOT NULL,
    "reason" TEXT,
    "clientPoNumber" TEXT,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_portal_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_submissions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_shares_clientId_idx" ON "portal_shares"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_shares_project_live_key" ON "portal_shares"("projectId") WHERE ("revokedAt" IS NULL AND "projectId" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "portal_shares_quote_live_key" ON "portal_shares"("quoteId") WHERE ("revokedAt" IS NULL AND "quoteId" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "portal_shares_document_live_key" ON "portal_shares"("documentId") WHERE ("revokedAt" IS NULL AND "documentId" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "quote_portal_responses_versionId_key" ON "quote_portal_responses"("versionId");

-- CreateIndex
CREATE INDEX "portal_submissions_projectId_idx" ON "portal_submissions"("projectId");

-- AddForeignKey
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_portal_responses" ADD CONSTRAINT "quote_portal_responses_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_portal_responses" ADD CONSTRAINT "quote_portal_responses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_portal_responses" ADD CONSTRAINT "quote_portal_responses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A share points at exactly one record of its kind (docs/client-portal.md).
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_one_target" CHECK (
  ("kind" = 'PROJECT' AND "projectId" IS NOT NULL AND "quoteId" IS NULL AND "documentId" IS NULL)
  OR ("kind" = 'QUOTE' AND "quoteId" IS NOT NULL AND "projectId" IS NULL AND "documentId" IS NULL)
  OR ("kind" = 'DOCUMENT' AND "documentId" IS NOT NULL AND "projectId" IS NULL AND "quoteId" IS NULL)
);
ALTER TABLE "portal_shares" ADD CONSTRAINT "portal_shares_revoked_by" CHECK (
  ("revokedAt" IS NULL) = ("revokedById" IS NULL)
);

-- Only the client's own records can be shared with it, and never a
-- restricted document. Once made, a share only changes by being revoked.
CREATE FUNCTION portal_share_guard() RETURNS trigger AS $$
DECLARE
  owner UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'revokedAt' - 'revokedById') <> (to_jsonb(OLD) - 'revokedAt' - 'revokedById')
       OR OLD."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A share can only be revoked, once' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."kind" = 'PROJECT' THEN
    SELECT "clientId" INTO owner FROM "projects" WHERE "id" = NEW."projectId";
  ELSIF NEW."kind" = 'QUOTE' THEN
    SELECT "clientId" INTO owner FROM "quotes" WHERE "id" = NEW."quoteId";
  ELSE
    SELECT CASE d."recordType"
             WHEN 'CLIENT' THEN d."recordId"
             WHEN 'PROJECT' THEN (SELECT p."clientId" FROM "projects" p WHERE p."id" = d."recordId")
             WHEN 'QUOTE' THEN (SELECT q."clientId" FROM "quotes" q WHERE q."id" = d."recordId")
           END
      INTO owner
      FROM "documents" d
     WHERE d."id" = NEW."documentId" AND d."access" = 'STANDARD';
  END IF;
  IF owner IS DISTINCT FROM NEW."clientId" THEN
    RAISE EXCEPTION 'Only the client''s own records can be shared with it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER portal_shares_guard
  BEFORE INSERT OR UPDATE ON "portal_shares"
  FOR EACH ROW EXECUTE FUNCTION portal_share_guard();
CREATE FUNCTION portal_shares_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Shares are revoked, never deleted' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER portal_shares_no_delete
  BEFORE DELETE ON "portal_shares"
  FOR EACH ROW EXECUTE FUNCTION portal_shares_no_delete();

-- A client's answer and what it sent are evidence: never changed or removed.
CREATE FUNCTION portal_evidence_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER quote_portal_responses_append_only
  BEFORE UPDATE OR DELETE ON "quote_portal_responses"
  FOR EACH ROW EXECUTE FUNCTION portal_evidence_append_only();
CREATE TRIGGER portal_submissions_append_only
  BEFORE UPDATE OR DELETE ON "portal_submissions"
  FOR EACH ROW EXECUTE FUNCTION portal_evidence_append_only();
