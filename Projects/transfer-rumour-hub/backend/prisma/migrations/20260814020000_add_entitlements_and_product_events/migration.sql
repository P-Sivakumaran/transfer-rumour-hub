-- Reversible: see down.sql in this same migration folder.
--   psql "$DATABASE_URL" -f prisma/migrations/20260814020000_add_entitlements_and_product_events/down.sql

-- CreateEnum
CREATE TYPE "EntitlementTier" AS ENUM ('FREE', 'PRO', 'RESEARCH');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('MANUAL');

-- CreateEnum
CREATE TYPE "AlertMode" AS ENUM ('DELAYED', 'INSTANT');

-- CreateEnum
CREATE TYPE "ProductEventType" AS ENUM ('WATCHLIST_CREATED', 'ALERT_ACTIVATED', 'PROVENANCE_PANEL_VIEWED', 'FORECAST_HISTORY_VIEWED', 'UPGRADE_INTEREST_CLICKED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "entitlementGrantedAt" TIMESTAMP(3),
ADD COLUMN     "entitlementSource" "EntitlementSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "tier" "EntitlementTier" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "watchlist_players" ADD COLUMN     "alertMode" "AlertMode" NOT NULL DEFAULT 'DELAYED';

-- CreateTable
CREATE TABLE "product_events" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "eventType" "ProductEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_events_eventType_createdAt_idx" ON "product_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "product_events_userId_idx" ON "product_events"("userId");

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

