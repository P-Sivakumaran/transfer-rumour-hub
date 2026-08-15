-- Reversible: see down.sql in this same migration folder for the rollback
-- DDL (drop the 3 new tables + 5 new sources columns + 4 new enum types, in
-- dependency order). Prisma Migrate has no built-in down-migration support —
-- none of the 7 migrations before this one have one either — so this is a
-- hand-written companion, run manually if this migration needs reverting:
--   psql "$DATABASE_URL" -f prisma/migrations/20260814012604_add_provenance_evidence_model/down.sql

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('PERMANENT', 'LOAN', 'FREE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('ACTIVE', 'DENIED', 'SUPERSEDED', 'CONFIRMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EvidenceDirection" AS ENUM ('SUPPORTS', 'CONTRADICTS', 'CONFIRMS', 'DENIES', 'CONTEXTUAL');

-- CreateEnum
CREATE TYPE "SourceReviewStatus" AS ENUM ('UNREVIEWED', 'APPROVED', 'FLAGGED');

-- AlterTable
ALTER TABLE "sources" ADD COLUMN     "journalistHandle" TEXT,
ADD COLUMN     "leagueCoverage" JSONB,
ADD COLUMN     "manualReviewStatus" "SourceReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "profileVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tier" INTEGER;

-- CreateTable
CREATE TABLE "claims" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "fromClubId" INTEGER,
    "toClubId" INTEGER,
    "transferType" "TransferType" NOT NULL DEFAULT 'UNKNOWN',
    "statedFee" DOUBLE PRECISION,
    "statedContractLengthMonths" INTEGER,
    "claimStatus" "ClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvidenceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_items" (
    "id" SERIAL NOT NULL,
    "claimId" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorName" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "rawExcerpt" TEXT NOT NULL,
    "extractedAttributions" JSONB,
    "evidenceDirection" "EvidenceDirection" NOT NULL DEFAULT 'SUPPORTS',
    "parentEvidenceItemId" INTEGER,
    "provenanceRootId" INTEGER,
    "extractionConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_duplicate_candidates" (
    "id" SERIAL NOT NULL,
    "evidenceItemId" INTEGER NOT NULL,
    "candidateItemId" INTEGER NOT NULL,
    "similarityScore" DOUBLE PRECISION NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claims_playerId_fromClubId_toClubId_idx" ON "claims"("playerId", "fromClubId", "toClubId");

-- CreateIndex
CREATE INDEX "claims_claimStatus_idx" ON "claims"("claimStatus");

-- CreateIndex
CREATE INDEX "evidence_items_claimId_idx" ON "evidence_items"("claimId");

-- CreateIndex
CREATE INDEX "evidence_items_provenanceRootId_idx" ON "evidence_items"("provenanceRootId");

-- CreateIndex
CREATE INDEX "evidence_items_sourceId_idx" ON "evidence_items"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_items_canonicalUrl_claimId_key" ON "evidence_items"("canonicalUrl", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_duplicate_candidates_evidenceItemId_candidateItemI_key" ON "evidence_duplicate_candidates"("evidenceItemId", "candidateItemId");

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_fromClubId_fkey" FOREIGN KEY ("fromClubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_toClubId_fkey" FOREIGN KEY ("toClubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_parentEvidenceItemId_fkey" FOREIGN KEY ("parentEvidenceItemId") REFERENCES "evidence_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_provenanceRootId_fkey" FOREIGN KEY ("provenanceRootId") REFERENCES "evidence_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_duplicate_candidates" ADD CONSTRAINT "evidence_duplicate_candidates_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "evidence_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_duplicate_candidates" ADD CONSTRAINT "evidence_duplicate_candidates_candidateItemId_fkey" FOREIGN KEY ("candidateItemId") REFERENCES "evidence_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

