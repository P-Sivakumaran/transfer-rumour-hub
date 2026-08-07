-- CreateTable
CREATE TABLE "raw_signals" (
    "id" SERIAL NOT NULL,
    "sourceName" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "rawText" TEXT NOT NULL,
    "impliedReliability" DOUBLE PRECISION,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "rumourId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raw_signals_sourceName_publishedAt_idx" ON "raw_signals"("sourceName", "publishedAt");

-- CreateIndex
CREATE INDEX "raw_signals_matched_idx" ON "raw_signals"("matched");
