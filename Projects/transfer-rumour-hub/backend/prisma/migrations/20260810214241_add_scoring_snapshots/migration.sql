-- CreateTable
CREATE TABLE "scoring_snapshots" (
    "id" SERIAL NOT NULL,
    "rumourId" INTEGER NOT NULL,
    "sourceReliability" DOUBLE PRECISION NOT NULL,
    "monthsToContractExpiry" DOUBLE PRECISION,
    "reportedFeeMin" DOUBLE PRECISION,
    "reportedFeeMax" DOUBLE PRECISION,
    "marketValue" DOUBLE PRECISION,
    "clubNeedScore" DOUBLE PRECISION NOT NULL,
    "distinctSourceCount" INTEGER NOT NULL,
    "baseProbability" DOUBLE PRECISION,
    "score" DOUBLE PRECISION NOT NULL,
    "scoreSource" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scoring_snapshots_rumourId_idx" ON "scoring_snapshots"("rumourId");

-- AddForeignKey
ALTER TABLE "scoring_snapshots" ADD CONSTRAINT "scoring_snapshots_rumourId_fkey" FOREIGN KEY ("rumourId") REFERENCES "rumours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
