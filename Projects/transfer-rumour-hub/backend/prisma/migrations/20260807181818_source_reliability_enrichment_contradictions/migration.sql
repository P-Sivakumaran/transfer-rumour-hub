-- AlterTable
ALTER TABLE "players" ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "wikidataId" TEXT;

-- AlterTable
ALTER TABLE "rumours" ADD COLUMN     "contradicts" INTEGER;

-- AlterTable
ALTER TABLE "sources" ADD COLUMN     "hitCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "missCount" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "rumours" ADD CONSTRAINT "rumours_contradicts_fkey" FOREIGN KEY ("contradicts") REFERENCES "rumours"("id") ON DELETE SET NULL ON UPDATE CASCADE;
