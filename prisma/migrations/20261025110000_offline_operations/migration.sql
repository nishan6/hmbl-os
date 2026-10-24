-- CreateEnum
CREATE TYPE "OfflineOperationStatus" AS ENUM ('APPLIED', 'CONFLICT', 'REJECTED');

-- CreateTable
CREATE TABLE "offline_operations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "OfflineOperationStatus" NOT NULL,
    "result" JSONB NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offline_operations_userId_receivedAt_idx" ON "offline_operations"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "offline_operations_projectId_idx" ON "offline_operations"("projectId");


-- What the device was told stays as it was: a resend must get the same answer.
CREATE TRIGGER offline_operations_append_only
  BEFORE UPDATE OR DELETE ON "offline_operations"
  FOR EACH ROW EXECUTE FUNCTION production_record_append_only();
