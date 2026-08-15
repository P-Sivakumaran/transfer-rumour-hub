-- Reversible: see down.sql in this same migration folder.
--   psql "$DATABASE_URL" -f prisma/migrations/20260814014218_add_forecasting_pipeline/down.sql

-- CreateEnum
CREATE TYPE "ForecastDisplayMode" AS ENUM ('PRECISE', 'INTERVAL', 'INSUFFICIENT_DATA');

-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "window" "TransferWindow";

-- CreateTable
CREATE TABLE "forecast_definitions" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "summerCutoffMonthDay" TEXT NOT NULL DEFAULT '08-31',
    "winterCutoffMonthDay" TEXT NOT NULL DEFAULT '01-31',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_versions" (
    "id" SERIAL NOT NULL,
    "forecastDefinitionId" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trainingDataSource" TEXT NOT NULL,
    "nTrainSamples" INTEGER NOT NULL,
    "nTestSamples" INTEGER NOT NULL,
    "trainStart" TIMESTAMP(3),
    "trainEnd" TIMESTAMP(3),
    "testStart" TIMESTAMP(3),
    "testEnd" TIMESTAMP(3),
    "brierScore" DOUBLE PRECISION,
    "logLoss" DOUBLE PRECISION,
    "calibrationCurve" JSONB,
    "minSampleSizeForPrecise" INTEGER NOT NULL DEFAULT 200,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_forecasts" (
    "id" SERIAL NOT NULL,
    "claimId" INTEGER NOT NULL,
    "forecastDefinitionId" INTEGER NOT NULL,
    "modelVersionId" INTEGER,
    "predictionTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "featureSnapshot" JSONB NOT NULL,
    "featureSnapshotHash" TEXT NOT NULL,
    "rawScore" DOUBLE PRECISION,
    "calibratedProbability" DOUBLE PRECISION,
    "uncertaintyLow" DOUBLE PRECISION,
    "uncertaintyHigh" DOUBLE PRECISION,
    "displayMode" "ForecastDisplayMode" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "insufficientDataReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forecast_definitions_version_key" ON "forecast_definitions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "model_versions_version_key" ON "model_versions"("version");

-- CreateIndex
CREATE INDEX "model_versions_forecastDefinitionId_isCurrent_idx" ON "model_versions"("forecastDefinitionId", "isCurrent");

-- CreateIndex
CREATE INDEX "claim_forecasts_claimId_predictionTimestamp_idx" ON "claim_forecasts"("claimId", "predictionTimestamp");

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_forecastDefinitionId_fkey" FOREIGN KEY ("forecastDefinitionId") REFERENCES "forecast_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_forecasts" ADD CONSTRAINT "claim_forecasts_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_forecasts" ADD CONSTRAINT "claim_forecasts_forecastDefinitionId_fkey" FOREIGN KEY ("forecastDefinitionId") REFERENCES "forecast_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_forecasts" ADD CONSTRAINT "claim_forecasts_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

