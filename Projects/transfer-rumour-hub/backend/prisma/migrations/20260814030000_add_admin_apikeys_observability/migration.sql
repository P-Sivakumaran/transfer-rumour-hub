-- Reversible: see down.sql in this same migration folder.
--   psql "$DATABASE_URL" -f prisma/migrations/20260814030000_add_admin_apikeys_observability/down.sql
-- Rollback note: do not run down.sql against a database whose Prisma
-- Client is still generated from the post-migration schema — see
-- docs/public-beta-readiness-audit.md §6 / docs/admin-operations.md.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('ENTITLEMENT_GRANT');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('RESEARCH_READ', 'RESEARCH_EXPORT');

-- CreateEnum
CREATE TYPE "ApiEndpointCategory" AS ENUM ('HISTORICAL_CLAIMS', 'EVIDENCE_METADATA');

-- CreateEnum
CREATE TYPE "ApiResponseClass" AS ENUM ('SUCCESS', 'UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "OperationalEventType" AS ENUM ('ENTITLEMENT_DENIED', 'FEATURE_FLAG_DENIED', 'WATCHLIST_CAP_REACHED', 'API_KEY_ACCEPTED', 'API_KEY_REJECTED', 'API_KEY_RATE_LIMITED', 'ADMIN_TIER_GRANT_SUCCESS', 'ADMIN_TIER_GRANT_FAILURE', 'RETENTION_PURGE_SUCCESS', 'RETENTION_PURGE_FAILURE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "admin_audit_events" (
    "id" SERIAL NOT NULL,
    "actingAdminUserId" INTEGER NOT NULL,
    "actionType" "AdminActionType" NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "previousTier" "EntitlementTier",
    "newTier" "EntitlementTier",
    "entitlementSource" "EntitlementSource",
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" "ApiKeyScope"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_usage_events" (
    "id" SERIAL NOT NULL,
    "apiKeyId" INTEGER,
    "endpointCategory" "ApiEndpointCategory" NOT NULL,
    "responseClass" "ApiResponseClass" NOT NULL,
    "rateLimitState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_events" (
    "id" SERIAL NOT NULL,
    "eventType" "OperationalEventType" NOT NULL,
    "correlationId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purge_health" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastRunStartedAt" TIMESTAMP(3),
    "lastRunCompletedAt" TIMESTAMP(3),
    "lastRunSucceeded" BOOLEAN,
    "lastDeletedCount" INTEGER,
    "lastCutoff" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purge_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_events_targetUserId_createdAt_idx" ON "admin_audit_events"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_events_actingAdminUserId_createdAt_idx" ON "admin_audit_events"("actingAdminUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyPrefix_key" ON "api_keys"("keyPrefix");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "api_key_usage_events_apiKeyId_createdAt_idx" ON "api_key_usage_events"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "operational_events_eventType_createdAt_idx" ON "operational_events"("eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actingAdminUserId_fkey" FOREIGN KEY ("actingAdminUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_usage_events" ADD CONSTRAINT "api_key_usage_events_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

