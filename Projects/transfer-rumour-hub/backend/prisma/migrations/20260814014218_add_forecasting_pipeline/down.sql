-- Rollback for 20260814014218_add_forecasting_pipeline.
-- Apply by hand: psql "$DATABASE_URL" -f down.sql
-- Then remove this migration's directory and its row from
-- the _prisma_migrations table before running `prisma migrate deploy` again.

DROP TABLE IF EXISTS "claim_forecasts";
DROP TABLE IF EXISTS "model_versions";
DROP TABLE IF EXISTS "forecast_definitions";

ALTER TABLE "claims" DROP COLUMN IF EXISTS "window";

DROP TYPE IF EXISTS "ForecastDisplayMode";
