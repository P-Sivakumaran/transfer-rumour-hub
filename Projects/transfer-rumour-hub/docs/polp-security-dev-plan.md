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

## Phase 3 — DB role separation (plan only — do NOT execute without sign-off)

Per [[feedback_transfer_hub_no_wipe]]: no disruptive DB changes while the
user is browsing the live app. This phase is delivered as **files only**:

- `backend/prisma/roles.sql` (new): `CREATE ROLE app_runtime` (DML only, no
  DDL, no `DROP`/`ALTER`), separate `CREATE ROLE app_migrator` (owns schema,
  used only for `prisma migrate deploy`).
- `.env.example` updated with `DATABASE_URL` (runtime, `app_runtime`) and
  `MIGRATE_DATABASE_URL` (`app_migrator`) — Prisma supports a separate
  migration connection string.
- `train_forecast.py` gets a third, read-only role (`app_readonly`) — it
  only runs `SELECT`.
- Actually running the `CREATE ROLE`/`REVOKE`/`GRANT` statements against the
  live DB, and swapping `DATABASE_URL`, requires explicit go-ahead — this
  changes what the running dev server can do mid-session.

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
