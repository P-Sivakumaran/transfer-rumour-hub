-- Rollback for 20260825000000_add_scoring_snapshots
ALTER TABLE "scoring_snapshots" DROP CONSTRAINT "scoring_snapshots_rumourId_fkey";
DROP TABLE "scoring_snapshots";
