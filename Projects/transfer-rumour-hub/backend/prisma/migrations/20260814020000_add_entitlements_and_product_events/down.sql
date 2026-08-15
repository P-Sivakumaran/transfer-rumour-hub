-- Down-migration for 20260814020000_add_entitlements_and_product_events.
-- Prisma has no native down-migration support; hand-written, mirrors the
-- up-migration exactly in reverse.

ALTER TABLE "product_events" DROP CONSTRAINT "product_events_userId_fkey";

DROP TABLE "product_events";

ALTER TABLE "watchlist_players" DROP COLUMN "alertMode";

ALTER TABLE "users" DROP COLUMN "entitlementGrantedAt",
DROP COLUMN "entitlementSource",
DROP COLUMN "tier";

DROP TYPE "ProductEventType";

DROP TYPE "AlertMode";

DROP TYPE "EntitlementSource";

DROP TYPE "EntitlementTier";
