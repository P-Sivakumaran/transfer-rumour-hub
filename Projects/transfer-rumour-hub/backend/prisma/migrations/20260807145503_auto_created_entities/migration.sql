-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "autoCreated" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "league" SET DEFAULT 'Unknown',
ALTER COLUMN "country" SET DEFAULT 'Unknown';

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "autoCreated" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "position" DROP NOT NULL;
