-- CreateEnum
CREATE TYPE "Position" AS ENUM ('GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('JOURNALIST', 'CLUB_OFFICIAL', 'AGENT', 'NEWS_OUTLET', 'SOCIAL_MEDIA', 'AGGREGATOR');

-- CreateEnum
CREATE TYPE "TransferWindow" AS ENUM ('SUMMER', 'WINTER', 'FREE_AGENT');

-- CreateEnum
CREATE TYPE "RumourStatus" AS ENUM ('PENDING', 'HOT', 'COMPLETED', 'FAILED', 'DENIED');

-- CreateTable
CREATE TABLE "clubs" (
    "id" SERIAL NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "league" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" SERIAL NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "position" "Position" NOT NULL,
    "currentClubId" INTEGER,
    "contractEnd" TIMESTAMP(3),
    "marketValue" DOUBLE PRECISION,
    "nationality" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "country" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rumours" (
    "id" SERIAL NOT NULL,
    "externalId" TEXT,
    "playerId" INTEGER NOT NULL,
    "fromClubId" INTEGER NOT NULL,
    "toClubId" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "reportedFeeMin" DOUBLE PRECISION,
    "reportedFeeMax" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "rumourDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window" "TransferWindow" NOT NULL,
    "baseProbability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "computedLikelihood" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "RumourStatus" NOT NULL DEFAULT 'PENDING',
    "distinctSourceCount" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rumours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rumour_history" (
    "id" SERIAL NOT NULL,
    "rumourId" INTEGER NOT NULL,
    "computedLikelihood" DOUBLE PRECISION NOT NULL,
    "status" "RumourStatus" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rumour_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clubs_externalId_key" ON "clubs"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "players_externalId_key" ON "players"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_name_key" ON "sources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rumours_externalId_key" ON "rumours"("externalId");

-- CreateIndex
CREATE INDEX "rumour_history_rumourId_recordedAt_idx" ON "rumour_history"("rumourId", "recordedAt");

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_currentClubId_fkey" FOREIGN KEY ("currentClubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rumours" ADD CONSTRAINT "rumours_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rumours" ADD CONSTRAINT "rumours_fromClubId_fkey" FOREIGN KEY ("fromClubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rumours" ADD CONSTRAINT "rumours_toClubId_fkey" FOREIGN KEY ("toClubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rumours" ADD CONSTRAINT "rumours_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rumour_history" ADD CONSTRAINT "rumour_history_rumourId_fkey" FOREIGN KEY ("rumourId") REFERENCES "rumours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
