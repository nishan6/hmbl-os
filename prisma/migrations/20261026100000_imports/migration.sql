-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CLIENTS', 'VENDORS', 'CREW', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('STAGED', 'COMMITTING', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ImportDecision" AS ENUM ('CREATE', 'UPDATE', 'SKIP');

-- CreateEnum
CREATE TYPE "ImportOutcome" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'STAGED',
    "fileName" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "headers" TEXT[],
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "rowCount" INTEGER NOT NULL,
    "summary" JSONB,
    "createdById" UUID NOT NULL,
    "commitStartedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "committedById" UUID,
    "discardedAt" TIMESTAMP(3),
    "discardedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "values" TEXT[],
    "edits" JSONB NOT NULL DEFAULT '{}',
    "status" "ImportRowStatus" NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '{}',
    "matchId" UUID,
    "matchLabel" TEXT,
    "matchReason" TEXT,
    "matchCanCreate" BOOLEAN NOT NULL DEFAULT true,
    "decision" "ImportDecision",
    "decidedById" UUID,
    "outcome" "ImportOutcome",
    "outcomeMessage" TEXT,
    "recordId" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_kind_createdAt_idx" ON "import_batches"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_line_key" ON "import_rows"("batchId", "line");

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

