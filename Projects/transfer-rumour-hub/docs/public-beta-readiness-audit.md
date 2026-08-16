# Public-beta readiness audit

Read-only inspection pass, written before any code in this task's scope
changed. Covers the six gaps closed by this work: role-based admin,
Research API keys, retention-purge scheduling, the watchlist-cap race,
operational observability, and their docs. Billing remains explicitly out
of scope — nothing here adds payment processing.

## 1. Current architecture and authentication flow

**Auth**: JWT in an httpOnly cookie (`middleware/auth.ts`). `requireAuth`
401s if no valid cookie; `optionalAuth` populates `req.userId` when present
and lets the request through either way. The JWT payload is just
`{ userId }` — no role or tier is embedded in the token, so every
tier/role-sensitive check re-reads `User` from Postgres per request. That's
a deliberate existing property (a revoked/demoted user takes effect
immediately, not at token expiry) and this work preserves it rather than
moving role into the JWT.

**Entitlement resolver** (`entitlements/`): a pure two-layer check —
`ENTITLEMENTS` (tier required per feature) and a separate `isFeatureEnabled`
kill-switch, env-var-overridden, no DB table. `requireEntitlement(db,
featureKey)` middleware treats anonymous requests as FREE tier rather than
401ing, because its job is upgrade messaging, not authentication — routes
needing a login already run `requireAuth` first in their own chain. This
model is being extended, not replaced: Research API keys plug into the same
`checkEntitlement` function via a new middleware, not a parallel one.

**Admin routes today**: `routes/admin.ts` has no auth on nine of its ten
routes at all — a pre-existing gap, documented but not fixed in the
monetisation session. The tenth (`POST /users/:id/entitlement`, added last
session) is gated by a single shared secret compared against
`req.header('x-admin-token')`, refusing outright (501) if `ADMIN_TOKEN`
isn't set. That route is this audit's primary target: Phase 2 replaces it
with authenticated RBAC and, per this task's explicit "retire the
shared-secret pattern" instruction, removes `ADMIN_TOKEN` rather than
keeping it as a disabled-by-default fallback — two parallel admin-auth
paths is more attack surface for the same capability, and nothing else in
the codebase depends on `ADMIN_TOKEN` (grepped; single call site). The other
nine unauthenticated `/admin/*` routes are out of this task's stated scope
("do not touch unrelated backend files") and remain a known gap, restated
below.

**Update 2026-08-15**: the above describes state at the time this audit was
written. All nine were subsequently closed (`docs/polp-security-dev-plan.md`
Phase 1) — every `/admin/*` route now requires `requireAdmin`, router-wide.
Verified live 2026-08-16 (`curl`, no cookie → 401 on all five previously-open
routes). §2/§4's file lists and the "9 unauthenticated" figure elsewhere in
this document describe the pre-Phase-1 state and are left as historical
record rather than rewritten.

**Jobs**: BullMQ (`queue/`), Redis-backed via `ioredis`, already running
five queues (`ingest`, `score`, `dedupe`, `enrich`, `player-sync`) with
`upsertJobScheduler` for recurring work — this is the mechanism Phase 4's
daily purge job reuses, not a new cron layer. A second, older scheduler
(`ingestion/scheduler.ts`, `node-cron`) exists in parallel for a single
`recomputeAllLikelihoods` job; it's a live but separate system, not touched
here — BullMQ is the actively-extended one (the RSS-source sweep fixed
2026-08-13 was added there, not to node-cron).

**Testing**: mostly in-memory fake-DB unit tests (`makeFakeTable` pattern in
`playerClubSync.test.ts`, `claimsService.test.ts`); one real-Postgres
integration test exists (`evidence.integration.test.ts`, self-cleaning via
`afterAll`). No test currently spins up the Express app itself (no
supertest anywhere in the repo) — every controller-level behavior verified
last session was via live `curl` against a running dev server, not an
automated integration test. This audit's Phase 5 concurrency test breaks
that pattern deliberately (see §6) because a pure-function unit test cannot
prove a database-level race is closed.

## 2. Exact files to change and why

| File | Why |
|---|---|
| `backend/prisma/schema.prisma` | `Role` enum + `User.role`; `AdminAuditEvent`; `ApiKey`; `ApiKeyUsageEvent` (minimized); `OperationalEvent`; single-row `PurgeHealth`. One migration, see §6. |
| `backend/src/middleware/adminAuth.ts` (new) | `requireAdmin` — re-reads `User.role` per request, same pattern as `requireEntitlement`. |
| `backend/src/routes/admin.ts` | Replace `requireAdminToken` with `requireAdmin` on the entitlement-grant route only (in scope); add rate limiting. |
| `backend/src/services/adminBootstrap.ts` (new) | `BOOTSTRAP_ADMIN_EMAIL` startup hook — see §4 for the ordering constraint. |
| `backend/src/index.ts` | Call the bootstrap hook at startup; mount correlation-ID middleware; mount API-key routes. |
| `backend/src/apiKeys/` (new dir) | `db.ts`, `hashing.ts`, `service.ts`, `middleware.ts`, controller, routes — mirrors `entitlements/`'s DI-testable module shape. |
| `backend/src/analytics/operationalEvents.ts` (new) | `OperationalEvent` logging, schema-typed so claim/player IDs can't be passed — mirrors `analytics/events.ts`'s existing `ProductEvent` shape. |
| `backend/src/queue/queues.ts`, `queue/scheduler.ts` | Add `maintenanceQueue` + daily `upsertJobScheduler` entry for the purge job. |
| `backend/src/queue/workers.ts` | Add the purge job's worker handler. |
| `backend/src/analytics/retention.ts` | Extend `purgeOldProductEvents` to write the single-row purge-health record and accept a configurable retention window. |
| `backend/src/services/watchlistService.ts`, `controllers/watchlistController.ts` | Interactive `$transaction` + advisory lock around the count-then-insert. |
| `backend/src/lib/rateLimit.ts` (new) | Small Redis-backed fixed-window limiter, reused by both the admin-grant route and the API-key middleware. |
| `docs/monetisation-proposal.md` | Note ADMIN_TOKEN's retirement and the role model. |
| `docs/research-api.md`, `docs/admin-operations.md`, `docs/data-retention.md` (new) | Per task spec. |

No frontend files change in this task — nothing in scope touches UI.

## 3. What's implementable within the current stack

Everything in scope. Specifically:

- **RBAC**: `User.role` is a normal Prisma enum column; no new infra.
- **API keys**: `crypto.createHash('sha256')` (Node builtin) for secret
  hashing, no new dependency — see §4 for why this is the right primitive,
  not bcrypt.
- **Rate limiting**: no rate-limiting library exists in this repo at all
  (`express-rate-limit` is not installed, confirmed via `package.json`
  grep). `ioredis` is available — but note it lives in the **root**
  `package.json` (`bullmq`, `ioredis`, `iconv-lite`, `rss-parser`), not
  `backend/package.json`, because npm workspaces hoist it. `queue/
  connection.ts` already imports `ioredis` this way without it being listed
  in `backend/package.json`'s own dependencies — this is the established,
  working convention in this repo, not an oversight, and the new rate
  limiter follows the same pattern rather than adding a redundant explicit
  dependency entry.
- **Scheduled purge**: BullMQ's `upsertJobScheduler` is already the
  recurring-job mechanism for five other jobs; the purge job is a sixth,
  no new infra.
- **Watchlist race fix**: Postgres advisory locks
  (`pg_advisory_xact_lock`) are available via `$queryRaw`/`$executeRaw`
  inside a Prisma interactive transaction. **This is the first
  `$transaction` call anywhere in this codebase** — grepped, zero existing
  usages of `$transaction`, `$queryRaw`, `$executeRaw`, `FOR UPDATE`, or
  `SERIALIZABLE`. No precedent to follow; the implementation in Phase 5 is
  the first of its kind here and documented more heavily than usual for
  that reason.
- **Observability**: a new Prisma model plus a request-scoped correlation
  ID (`randomUUID()`, already used once in this codebase for SSE client
  IDs) is sufficient; no APM/tracing vendor needed or added.

## 4. Missing infrastructure / constraints that shape the implementation

- **No admin bootstrap mechanism exists.** Retiring `ADMIN_TOKEN` and
  requiring `requireAdmin` for the grant route creates a chicken-and-egg
  problem: nothing can grant the first admin without already being an
  admin. Resolved via `BOOTSTRAP_ADMIN_EMAIL`, read once at server startup
  — if set and a `User` with that email exists, its role is (idempotently)
  set to `ADMIN`. **Ordering constraint, stated plainly because it will
  otherwise surprise whoever runs the smoke test**: the user must already
  be registered before the env var takes effect, since it's applied at
  boot, not on registration. The real sequence is register → set env var →
  restart → login. `docs/admin-operations.md` states this explicitly rather
  than implying a one-shot flow.
- **No supertest/HTTP-level test harness.** Every existing test is either a
  pure-function unit test against an in-memory fake, or (once) a real-DB
  integration test that calls service functions directly, never through
  Express routing/middleware. Phase 2's RBAC tests and Phase 3's API-key
  tests therefore test at the same two levels (middleware unit tests with a
  fake DB, service-level integration tests against real Postgres) rather
  than introducing a new HTTP-mocking dependency — consistent with "reuse
  existing test conventions," but it means route-wiring itself (which
  middleware is mounted in which order) is verified by live `curl` against
  a running server, not by an automated test, same as prior sessions.
- **No rate-limiting infrastructure, and no multi-instance deployment model
  documented anywhere in the repo** (no `docker-compose.yml`/k8s
  manifest/PM2 config found). A Redis-backed limiter is chosen over an
  in-process one specifically so correctness doesn't silently break if this
  is ever run as more than one instance — but there's no evidence either
  way about the actual target deployment shape, flagged as an assumption in
  §5.
- **No existing distinction between "security audit log" and "product
  analytics"** prior to this task — `ProductEvent` (last session) was the
  only event table. `AdminAuditEvent` and `OperationalEvent` are new,
  separate tables specifically because the task requires that separation
  and conflating them would make `ProductEvent`'s existing privacy
  guarantees (documented in `docs/monetisation-proposal.md`) harder to
  reason about as the schema grows.

## 5. Security and operational assumptions

- Single backend process assumed for correctness of in-process state (there
  is none load-bearing left after this task — the advisory lock and rate
  limiter are both Postgres/Redis-backed specifically to avoid this
  assumption being required).
- `BOOTSTRAP_ADMIN_EMAIL` is trusted operator-supplied config (same trust
  level as `DATABASE_URL`, `JWT_SECRET`) — not attacker-reachable input.
- API key secrets are shown exactly once, at creation, over the same
  authenticated HTTPS-in-production channel as every other authenticated
  response in this app; no separate secure-delivery mechanism (e.g. email)
  is built, matching the task's "do not add... infrastructure" framing.
- Rate limits are per-key or per-route-plus-user, held in Redis with a TTL;
  a Redis outage fails the limiter open or closed is a real decision — this
  implementation fails **closed** for the admin-grant route (a stricter,
  low-traffic, high-consequence route) and **open** for API-key request
  rate limiting (a Redis outage blocking all Research API traffic is a
  worse operational outcome than temporarily unlimited reads of
  already-public-ish aggregate data) — documented per-limiter, not a global
  rule.
- ~~The nine pre-existing unauthenticated `/admin/*` routes remain
  unauthenticated.~~ Closed 2026-08-15: all `/admin/*` routes now require
  `requireAdmin`, router-wide. See `docs/polp-security-dev-plan.md` Phase 1.

## 6. Migration and rollback plan

One migration, `<timestamp>_add_admin_apikeys_observability`, covering:
`Role` enum + `User.role` column (default `USER`, so existing rows need no
backfill), `AdminAuditEvent`, `ApiKey`, `ApiKeyUsageEvent`,
`OperationalEvent`, and a single-row `PurgeHealth` table (`id` fixed to `1`,
upserted, never grown — deliberately not an append-only log, since an
unbounded audit-style table for purge runs would just recreate the
retention problem this task is closing elsewhere).

Batched into one migration rather than five per-phase ones: all six phases'
schema needs are known upfront (unlike the incremental discovery that
produced two separate migrations last session), and one hand-written
`down.sql` is less to keep in sync than five. Generated the same way as
every prior migration in this repo — `prisma migrate diff` against the
shadow DB, reviewed by hand, `down.sql` written to exactly reverse it in
dependency order (drop FK-dependent tables first, then the column, then the
enum).

Rollback: run the migration's `down.sql` directly
(`psql "$DATABASE_URL" -f .../down.sql`), same operational pattern as every
prior migration in this repo. Rolling back drops `AdminAuditEvent`,
`ApiKey`, `ApiKeyUsageEvent`, `OperationalEvent`, and `PurgeHealth`
entirely (data loss, same as any down-migration in this repo — none of the
prior ones preserve data either) and removes `User.role` — which means
`requireAdmin` would then find no such column and every admin route would
error rather than silently open up, since Prisma Client generated against
the new schema would reject queries against the old one. Operational
runbook note added to `docs/admin-operations.md`: never roll back this
migration on a database whose Prisma Client hasn't also been rolled back to
the matching pre-migration commit.

## 7. Test plan

- **Unit (fake DB)**: `requireAdmin` — 401 no user, 403 non-admin, next()
  for admin (mirrors `entitlements/middleware.test.ts`'s existing shape).
  API-key middleware — same shape, plus expiry/revocation/scope cases.
  Rate limiter — window boundary behavior against a fake Redis-like
  counter.
- **Integration (real Postgres, `afterAll`-cleaning, mirrors
  `evidence.integration.test.ts`)**: admin grant end-to-end including audit
  event creation; API key creation → real request → usage log; the
  watchlist concurrency test (real parallel requests, see below).
- **Concurrency test, Phase 5** — the one genuinely new kind of test in
  this repo. `Promise.all` of N concurrent `addToWatchlist` calls for the
  same FREE user against a **real** Postgres connection pool (not the fake
  DB — a fake in-memory table can't race), then querying the actual row
  count afterward. Written to fail if the advisory lock is removed
  (verified by temporarily deleting the lock call and re-running before
  finalizing the test), per this task's instruction that a race test must
  prove it can fail.
- **Retention job**: unit tests for `purgeOldProductEvents` boundary
  behavior (already exist, extended for configurable retention days) plus
  one integration test that the BullMQ job is registered
  (`getJobSchedulers()`, same assertion style as the existing orphaned-RSS-
  scheduler test could use, though none currently does).
