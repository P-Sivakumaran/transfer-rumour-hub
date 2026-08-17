# Principle of Least Privilege (PoLP) — security dev plan

Written 2026-08-14. Scope: transfer-rumour-hub only. Ranked by exploitability,
not by category — Phase 1 is the only must-land item, the rest is
defense-in-depth or requires the user's sign-off before touching the live DB.

## Current state (facts, not opinions)

- **DB**: one Postgres role (`postgres`, superuser per `.env.example`) used by
  the API server, all BullMQ workers, and the offline
  `ml-service/app/forecasting/train_forecast.py` script. Same role runs
  `prisma migrate deploy` (DDL) and all runtime DML. No read/write split, no
  migration-only credential.
- **Auth**: JWT cookie carries only `{userId}`; role/tier re-read from
  Postgres per request (deliberate — see `docs/public-beta-readiness-audit.md`).
  `requireAdmin(db)` (`backend/src/admin/middleware.ts`) is a proven,
  already-in-use primitive — 3 of 10 admin routes use it.
- **API keys**: genuinely scoped (`RESEARCH_READ` / `RESEARCH_EXPORT`,
  `backend/src/apiKeys/db.ts`), per-route enforcement, rate-limited. **No
  work needed here.**
- **ML service**: `ml-service/app/main.py` has zero auth on any route.
  README's dev command (`uvicorn app.main:app --port 8000`) binds
  `127.0.0.1` by default (no `--host` flag) — localhost-only in dev. No
  Dockerfile/compose/deploy config in the repo to confirm prod binding.
- **Workers**: run in-process with the API server (`index.ts`), same env,
  same DB credentials. Not touched by this plan — process separation is an
  architecture change, named below as future work only.

## Phase 1 — close the open admin routes (do now, code)

`backend/src/routes/admin.ts` has 5 of 10 routes with no auth at all:
`PATCH /rumours/:id/outcome`, `GET /sources`, `POST /players/:id/enrich`,
`POST /players/sync`, `GET /rumours`. This is a **live, remotely exploitable
gap** — anyone who can reach the port can rewrite transfer outcomes and
flood the enrich/player-sync BullMQ queues.

Verified safe to gate: `frontend/src/lib/api.ts` already calls all of
`rumours`, `sources`, `setOutcome`, `enrichPlayer` with
`credentials: 'include'`, so the session cookie is already sent — adding
`requireAdmin` doesn't break the existing admin UI, it just requires the
user hitting it to actually be `role: ADMIN`. `POST /players/sync` has no
frontend caller at all (ops-only, curl/manual).

Action: add `router.use(requireAdmin(adminDb))` (or per-route, matching the
existing 3) to all 5. Update the stale gap-count in
`docs/public-beta-readiness-audit.md` (says "nine unauthenticated", it's
now 5 including this fix, 0 after).

## Phase 2 — ML service auth (do now, code, cheap)

Even though dev binds localhost, add a shared-secret header check
(`X-ML-Service-Key` or similar) between the backend and
`ml-service/app/main.py`, matching the pattern already used for API keys —
not a new mechanism. Backend sends it via `axios` headers in
`likelihoodEngine.ts` / `mlForecastClient.ts`; FastAPI checks it via a
dependency. Cheap, and removes reliance on network topology (prod deploy
config is unknown/unverified) as the only control.

## Phase 3 — DB role separation (executed 2026-08-17)

Two new roles created and verified against the live `transfer_hub` DB
(`backend/prisma/roles.sql`, idempotent GRANTs, re-runnable):

- `transfer_hub_runtime` — DML only (`SELECT`/`INSERT`/`UPDATE`/`DELETE`),
  no `CREATE`/`DROP`/`ALTER`. Intended for `DATABASE_URL` — the API server +
  BullMQ workers.
- `transfer_hub_readonly` — `SELECT` only. Intended for
  `ml-service/app/forecasting/train_forecast.py`'s raw `SELECT` (set
  `DATABASE_URL` to this role's connection string only when running that
  script, it's not wired into any `.env`).
- Migrations deliberately keep using the existing `user` role rather than a
  new `app_migrator` — `prisma migrate dev` needs `CREATEDB` for its shadow
  DB, which would make a dedicated migrator role nearly as powerful as the
  superuser anyway for a command that's run manually, not by a network-facing
  process. `MIGRATE_DATABASE_URL` in `.env.example` documents the override
  (`DATABASE_URL="$MIGRATE_DATABASE_URL" npm run migrate`) — not auto-read
  by anything, a manual convention.
- Real bug found and fixed during verification: this instance runs
  **Postgres 14**, where `public` schema grants `CREATE` to the `PUBLIC`
  pseudo-role by default (fixed only in PG15+). Without an explicit
  `REVOKE CREATE ON SCHEMA public FROM PUBLIC`, `transfer_hub_runtime` could
  `CREATE TABLE` despite never being granted that — confirmed empirically
  (`CREATE TABLE polp_test (id int);` succeeded before the revoke, denied
  after). `roles.sql` now revokes it.
- This Postgres instance is shared across unrelated projects on this
  machine (`polp_security` owned by role `polp`, `financial_suite` owned by
  `financial_user`, `crypto_db`, `resumemaster`) — confirmed neither
  pre-existing role/DB was touched; new roles are `transfer_hub_`-prefixed
  and scoped to the `transfer_hub` database only.
- **Not yet done**: swapping `backend/.env`'s live `DATABASE_URL` to
  `transfer_hub_runtime` and restarting the API server. The roles exist and
  are verified correct, but the currently-running dev server (PID at time of
  writing: check `lsof -i :3001`) still holds a superuser connection until
  restarted — deliberately left for the user to do (or ask Claude to do) at
  a moment that doesn't interrupt an in-progress session.

## Phase 4 — named future work (not implemented, not scheduled)

- Split workers into a separate process/container from the API server, with
  their own scoped DB role (write access to job tables, not full schema).
  Currently in-process (`index.ts`) — real architecture change, out of
  scope here.

## Verification plan

No supertest in the repo — unit tests won't prove route gating. Verify with
the dev server running + `curl`: each of the 5 formerly-open routes should
401/403 with no cookie, 200 with an admin session cookie. Will report
explicitly if the server isn't run rather than claiming this as tested.
