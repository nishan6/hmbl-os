-- CreateEnum
CREATE TYPE "AccountLinkPurpose" AS ENUM ('INVITE', 'RESET');

-- CreateTable
CREATE TABLE "account_links" (
    "id" UUID NOT NULL,
    "purpose" "AccountLinkPurpose" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" JSONB NOT NULL DEFAULT '[]',
    "resetTwoFactor" BOOLEAN NOT NULL DEFAULT false,
    "userId" UUID,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_links_tokenHash_key" ON "account_links"("tokenHash");

-- CreateIndex
CREATE INDEX "account_links_email_idx" ON "account_links"("email");

-- CreateIndex
CREATE INDEX "account_links_userId_idx" ON "account_links"("userId");

-- AddForeignKey
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A reset link always names whose password it sets.
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_reset_user"
  CHECK ("purpose" <> 'RESET' OR "userId" IS NOT NULL);
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_email_lower"
  CHECK ("email" = lower("email"));

-- Links are evidence of who was let in: what a link grants never changes, a
-- used or withdrawn link is final, and none is deleted.
CREATE FUNCTION account_links_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'account links can''t be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."usedAt" IS NOT NULL OR OLD."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a used or withdrawn account link can''t change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."email" IS DISTINCT FROM OLD."email"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."roles" IS DISTINCT FROM OLD."roles"
    OR NEW."resetTwoFactor" IS DISTINCT FROM OLD."resetTwoFactor"
    OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (OLD."userId" IS NOT NULL AND NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    RAISE EXCEPTION 'only using or withdrawing an account link can change it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER account_links_guard
  BEFORE UPDATE OR DELETE ON "account_links"
  FOR EACH ROW EXECUTE FUNCTION account_links_guard();
