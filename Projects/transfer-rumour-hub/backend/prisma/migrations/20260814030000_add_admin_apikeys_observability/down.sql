-- Down-migration for 20260814030000_add_admin_apikeys_observability.
-- Prisma has no native down-migration support; hand-written, mirrors the
-- up-migration exactly in reverse. Drops all data in the tables below —
-- same irreversibility as every other down.sql in this repo.

ALTER TABLE "api_key_usage_events" DROP CONSTRAINT "api_key_usage_events_apiKeyId_fkey";
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_userId_fkey";
ALTER TABLE "admin_audit_events" DROP CONSTRAINT "admin_audit_events_targetUserId_fkey";
ALTER TABLE "admin_audit_events" DROP CONSTRAINT "admin_audit_events_actingAdminUserId_fkey";

DROP TABLE "purge_health";
DROP TABLE "operational_events";
DROP TABLE "api_key_usage_events";
DROP TABLE "api_keys";
DROP TABLE "admin_audit_events";

ALTER TABLE "users" DROP COLUMN "role";

DROP TYPE "OperationalEventType";
DROP TYPE "ApiResponseClass";
DROP TYPE "ApiEndpointCategory";
DROP TYPE "ApiKeyScope";
DROP TYPE "AdminActionType";
DROP TYPE "Role";
