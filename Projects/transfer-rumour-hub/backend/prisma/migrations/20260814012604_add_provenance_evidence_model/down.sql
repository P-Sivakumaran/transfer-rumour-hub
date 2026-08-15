-- Rollback for 20260814012604_add_provenance_evidence_model.
-- Not run automatically by Prisma Migrate (no down-migration support) —
-- apply by hand: psql "$DATABASE_URL" -f down.sql
-- Then remove this migration's directory and its row from
-- the _prisma_migrations table before running `prisma migrate deploy` again.

DROP TABLE IF EXISTS "evidence_duplicate_candidates";
DROP TABLE IF EXISTS "evidence_items";
DROP TABLE IF EXISTS "claims";

ALTER TABLE "sources"
  DROP COLUMN IF EXISTS "journalistHandle",
  DROP COLUMN IF EXISTS "leagueCoverage",
  DROP COLUMN IF EXISTS "manualReviewStatus",
  DROP COLUMN IF EXISTS "profileVersion",
  DROP COLUMN IF EXISTS "tier";

DROP TYPE IF EXISTS "SourceReviewStatus";
DROP TYPE IF EXISTS "EvidenceDirection";
DROP TYPE IF EXISTS "ClaimStatus";
DROP TYPE IF EXISTS "TransferType";
