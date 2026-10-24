-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('STAFF', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PortalKind" AS ENUM ('CLIENT', 'VENDOR', 'FREELANCER');

-- CreateEnum
CREATE TYPE "PortalAccountStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kind" "UserKind" NOT NULL DEFAULT 'STAFF';

-- CreateTable
CREATE TABLE "portal_invitations" (
    "id" UUID NOT NULL,
    "kind" "PortalKind" NOT NULL,
    "clientId" UUID,
    "contactId" UUID,
    "vendorId" UUID,
    "crewMemberId" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "permissions" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "accountId" UUID,
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "PortalKind" NOT NULL,
    "clientId" UUID,
    "contactId" UUID,
    "vendorId" UUID,
    "crewMemberId" UUID,
    "permissions" TEXT[],
    "status" "PortalAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_invitations_tokenHash_key" ON "portal_invitations"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "portal_invitations_accountId_key" ON "portal_invitations"("accountId");

-- CreateIndex
CREATE INDEX "portal_invitations_clientId_idx" ON "portal_invitations"("clientId");

-- CreateIndex
CREATE INDEX "portal_invitations_vendorId_idx" ON "portal_invitations"("vendorId");

-- CreateIndex
CREATE INDEX "portal_invitations_crewMemberId_idx" ON "portal_invitations"("crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_accounts_userId_key" ON "portal_accounts"("userId");

-- CreateIndex
CREATE INDEX "portal_accounts_clientId_idx" ON "portal_accounts"("clientId");

-- CreateIndex
CREATE INDEX "portal_accounts_vendorId_idx" ON "portal_accounts"("vendorId");

-- CreateIndex
CREATE INDEX "portal_accounts_crewMemberId_idx" ON "portal_accounts"("crewMemberId");

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Each invitation and account belongs to exactly one organisation of its kind
-- (docs/portal.md). A client contact must be one of that client's contacts.
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_one_organisation" CHECK (
  ("kind" = 'CLIENT' AND "clientId" IS NOT NULL AND "contactId" IS NOT NULL AND "vendorId" IS NULL AND "crewMemberId" IS NULL)
  OR ("kind" = 'VENDOR' AND "vendorId" IS NOT NULL AND "clientId" IS NULL AND "contactId" IS NULL AND "crewMemberId" IS NULL)
  OR ("kind" = 'FREELANCER' AND "crewMemberId" IS NOT NULL AND "clientId" IS NULL AND "contactId" IS NULL AND "vendorId" IS NULL)
);
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_one_organisation" CHECK (
  ("kind" = 'CLIENT' AND "clientId" IS NOT NULL AND "contactId" IS NOT NULL AND "vendorId" IS NULL AND "crewMemberId" IS NULL)
  OR ("kind" = 'VENDOR' AND "vendorId" IS NOT NULL AND "clientId" IS NULL AND "contactId" IS NULL AND "crewMemberId" IS NULL)
  OR ("kind" = 'FREELANCER' AND "crewMemberId" IS NOT NULL AND "clientId" IS NULL AND "contactId" IS NULL AND "vendorId" IS NULL)
);
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_revoked_has_time" CHECK (
  ("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)
);
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_accepted_has_account" CHECK (
  ("acceptedAt" IS NULL) = ("accountId" IS NULL)
);

CREATE FUNCTION portal_contact_matches_client() RETURNS trigger AS $$
BEGIN
  IF NEW."contactId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "contacts" c WHERE c."id" = NEW."contactId" AND c."clientId" = NEW."clientId"
  ) THEN
    RAISE EXCEPTION 'The contact must belong to the client' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER portal_invitations_contact_matches_client
  BEFORE INSERT OR UPDATE ON "portal_invitations"
  FOR EACH ROW EXECUTE FUNCTION portal_contact_matches_client();
CREATE TRIGGER portal_accounts_contact_matches_client
  BEFORE INSERT OR UPDATE ON "portal_accounts"
  FOR EACH ROW EXECUTE FUNCTION portal_contact_matches_client();

-- A portal account's organisation and kind never change: revoke and invite again.
CREATE FUNCTION portal_account_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."contactId" IS DISTINCT FROM OLD."contactId"
     OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."crewMemberId" IS DISTINCT FROM OLD."crewMemberId" THEN
    RAISE EXCEPTION 'A portal account''s organisation cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'REVOKED' AND NEW."status" <> 'REVOKED' THEN
    RAISE EXCEPTION 'A revoked portal account cannot be restored' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER portal_accounts_fixed
  BEFORE UPDATE ON "portal_accounts"
  FOR EACH ROW EXECUTE FUNCTION portal_account_fixed();

-- External people never hold a role, and a user's kind never changes, so
-- nothing granted inside HMBL OS can reach a portal account.
CREATE FUNCTION user_roles_staff_only() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."userId" AND u."kind" <> 'STAFF') THEN
    RAISE EXCEPTION 'Portal users cannot hold a role' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_roles_staff_only
  BEFORE INSERT OR UPDATE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION user_roles_staff_only();

CREATE FUNCTION users_kind_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind" THEN
    RAISE EXCEPTION 'A user''s kind cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER users_kind_fixed
  BEFORE UPDATE OF "kind" ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_kind_fixed();

-- A portal account belongs to an external user, and only one.
CREATE FUNCTION portal_accounts_external_user() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."userId" AND u."kind" = 'EXTERNAL') THEN
    RAISE EXCEPTION 'A portal account needs an external user' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER portal_accounts_external_user
  BEFORE INSERT ON "portal_accounts"
  FOR EACH ROW EXECUTE FUNCTION portal_accounts_external_user();

-- Who manages portal access by default (docs/decisions.md "Portal access").
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r."id", p.permission
  FROM "roles" r
  CROSS JOIN (VALUES ('portal.view'), ('portal.create'), ('portal.edit'), ('portal.archive')) AS p(permission)
 WHERE r."isSystem" AND r."key" IN ('owner', 'administrator', 'sales', 'procurement', 'crew_coordinator')
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r."id", 'portal.view' FROM "roles" r
 WHERE r."isSystem" AND r."key" = 'viewer'
ON CONFLICT DO NOTHING;
