-- PoLP DB roles for transfer_hub — see docs/polp-security-dev-plan.md Phase 3.
--
-- This Postgres instance is shared across multiple unrelated projects (see
-- `\l` — polp_security, financial_suite, crypto_db, resumemaster all live
-- here under their own owners). Role names are prefixed transfer_hub_* to
-- avoid any ambiguity with those.
--
-- Scope: split the always-on, network-facing runtime (API server + BullMQ
-- workers) off the superuser it currently shares with migrations. Migrations
-- (`npm run migrate` → `prisma migrate dev`) deliberately keep using the
-- existing `user` role — `prisma migrate dev` creates/drops a shadow DB per
-- run, which needs CREATEDB; giving a dedicated migrator role that privilege
-- would make it nearly as powerful as the superuser anyway, for a command
-- that's run manually and infrequently, not by a network-facing process.
-- The real PoLP win here is the runtime role having no DDL at all.
--
-- Run once: psql "$DATABASE_URL" -v runtime_password='...' -v readonly_password='...' -f prisma/roles.sql
-- The GRANT statements below are safe to re-run; CREATE ROLE is not (errors
-- if the role already exists — that's fine for a one-time setup run).

CREATE ROLE transfer_hub_runtime LOGIN PASSWORD :'runtime_password';
CREATE ROLE transfer_hub_readonly LOGIN PASSWORD :'readonly_password';

-- This instance is Postgres 14, where the `public` schema grants CREATE to
-- the PUBLIC pseudo-role by default (changed only in PG15+) — without this
-- REVOKE, transfer_hub_runtime (and any other login role) can CREATE TABLE
-- in public regardless of the explicit GRANTs below. Verified empirically:
-- CREATE TABLE succeeded for transfer_hub_runtime before this line was
-- added. Safe to re-run.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- transfer_hub_runtime: used by backend/src (API server + BullMQ
-- workers/scheduler) via DATABASE_URL. DML only — no CREATE/DROP/ALTER, so a
-- compromised or buggy runtime process cannot alter schema or touch other
-- databases on this instance.
GRANT CONNECT ON DATABASE transfer_hub TO transfer_hub_runtime;
GRANT USAGE ON SCHEMA public TO transfer_hub_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO transfer_hub_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO transfer_hub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE "user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO transfer_hub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE "user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO transfer_hub_runtime;

-- transfer_hub_readonly: for ml-service/app/forecasting/train_forecast.py,
-- the offline training script that runs a raw SELECT against Postgres
-- outside the FastAPI service. Read-only, no INSERT/UPDATE/DELETE — a bug
-- in the training script cannot mutate production rumour/rating data.
GRANT CONNECT ON DATABASE transfer_hub TO transfer_hub_readonly;
GRANT USAGE ON SCHEMA public TO transfer_hub_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO transfer_hub_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE "user" IN SCHEMA public
  GRANT SELECT ON TABLES TO transfer_hub_readonly;
