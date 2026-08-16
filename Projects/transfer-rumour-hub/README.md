# Transfer Rumour Hub

Real-time football transfer rumour tracker with likelihood scoring, club dashboards, and live updates.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 App Router + Tailwind | RSC for SEO, file-based routing for /player/[id] and /club/[id] |
| Charts | Recharts | React-native, tree-shakeable, RadialBar for TruthMeter |
| Backend | Express + TypeScript | Lightweight, easy to extend to NestJS later |
| ORM | Prisma + Postgres | Type-safe queries, migrations built in |
| Real-time | Server-Sent Events | Simpler than WebSockets for one-way feed updates |
| Scheduler | node-cron | In-process cron for rumour ingestion + score recomputation |

## Project structure

```
transfer-rumour-hub/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # DB schema
│   │   └── seed.ts             # Realistic seed data
│   └── src/
│       ├── index.ts            # Express server + SSE endpoint
│       ├── routes/             # rumours / players / clubs / stats
│       ├── controllers/        # Request parsing + response shaping
│       ├── services/           # Prisma queries
│       ├── scoring/
│       │   └── likelihoodEngine.ts  # Heuristic scorer (swap for ML here)
│       ├── ingestion/
│       │   ├── sportmonks.ts   # Provider API client
│       │   └── scheduler.ts    # Cron: ingest + recompute
│       └── sse/
│           └── broadcaster.ts  # SSE client registry + broadcast
├── ml-service/
│   ├── app/
│   │   ├── main.py             # FastAPI: POST /score, GET /health
│   │   ├── heuristic.py        # Python port of likelihoodEngine.ts (breakdown + synthetic labels)
│   │   └── model.py            # feature vector encoding, model load/save
│   ├── train.py                 # --source synthetic (default) or db
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/                # Next.js App Router pages
        │   ├── page.tsx        # Global rumour feed
        │   ├── rumour/[id]/    # Rumour detail + timeline
        │   ├── player/[id]/    # Player page
        │   └── club/[id]/      # Club dashboard
        └── components/
            ├── RumourCard.tsx
            ├── TruthMeter.tsx  # Radial gauge (Recharts)
            ├── ClubDashboard.tsx
            ├── TimelineChart.tsx
            └── FilterBar.tsx
```

## Quickstart

### 1. Prerequisites

- Node.js 20+
- PostgreSQL running locally (or use Docker: `docker run -e POSTGRES_PASSWORD=password -p 5432:5432 postgres`)

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit DATABASE_URL and optionally SPORTMONKS_API_KEY

npm install
npm run generate          # generate Prisma client
npm run migrate           # run migrations
npm run seed              # seed clubs, players, sources, rumours
npm run dev               # http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev               # http://localhost:3000
```

### 4. ML scoring service (optional)

```bash
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python train.py                          # writes model.joblib (synthetic-labeled, see roadmap)
uvicorn app.main:app --port 8000
```

Set `ML_SCORING_URL="http://localhost:8000/score"` in `backend/.env` to use it. Leave unset (or let the process die) and the backend falls back to the built-in heuristic automatically — nothing else to configure.

`ml-service` checks an `X-ML-Service-Key` header if you set `ML_SERVICE_KEY`
in its environment — set the same value as `ML_SERVICE_KEY` in `backend/.env`
so the backend sends a matching header. Leave both unset for local dev (the
service treats a missing key as auth-disabled, not reject-everything); set
both in any shared/prod environment. See `docs/polp-security-dev-plan.md`.

### 5. Run together (from root)

```bash
npm install
npm run dev
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | /rumours | List/filter rumours (league, position, status, window, page) |
| GET | /rumours/:id | Single rumour with history |
| GET | /players/:id | Player + their rumours |
| GET | /players/search?q= | Player search |
| GET | /clubs | List clubs |
| GET | /clubs/:id | Club dashboard data |
| GET | /stats/sources | Source reliability stats |
| GET | /stats/overview | Global counts |
| GET | /events | SSE stream (rumour:updated, rumours:ingested) |
| POST | /auth/register | Create account, sets session cookie |
| POST | /auth/login | Log in, sets session cookie |
| POST | /auth/logout | Clear session cookie |
| GET | /auth/me | Current user (401 if not logged in) |
| GET | /watchlist | List watched players (auth required) |
| POST | /watchlist | Add player to watchlist (auth required) |
| DELETE | /watchlist/:playerId | Remove player from watchlist (auth required) |
| GET | /rumours?watchlist=true | Feed filtered to watched players (auth required) |

## Likelihood scoring

`backend/src/scoring/likelihoodEngine.ts`

Inputs → 0–100 score. Weight budget:

| Input | Max pts |
|---|---|
| Source reliability | 28 |
| Contract urgency | 20 |
| Club need | 20 |
| Distinct source count | 15 |
| Fee alignment to market value | 12 |
| Provider base probability | 5 |

**ML swap path:** replace the body of `computeScore()` with a call to a FastAPI micro-service accepting the same `ScoringInputs` and returning `{ score, breakdown }`. The interface is already typed.

## External API keys

| Variable | Where to get |
|---|---|
| `SPORTMONKS_API_KEY` | sportmonks.com → Developer → API tokens |

Without a key the ingestion module returns stub rumours automatically.

## Roadmap to MVP

- [x] Auth (JWT + httpOnly cookie, own Credentials flow rather than NextAuth.js — backend already owns the DB and every other route, so session issuance lives in Express, not the Next app) — user watchlists (player-level, feed filter via `?watchlist=true`); notifications still open
- [x] SSE hook in frontend — live TruthMeter updates without page refresh
- [x] Admin panel — manually set rumour status (COMPLETED / FAILED / DENIED), gated on linked source evidence
- [x] ML scoring service — `ml-service/` (FastAPI + scikit-learn RandomForest), backend calls it via `ML_SCORING_URL` with automatic fallback to the heuristic on error/timeout/unset. **Caveat:** as of 2026-08-12 the dev DB has only 6 rumours (5 PENDING, 1 COMPLETED) — nowhere near enough resolved outcomes to train a real classifier. The shipped model is trained on synthetic inputs labeled by the existing heuristic (`ml-service/train.py --source synthetic`, the default) — it stands up the service and swap path end-to-end but doesn't outperform the heuristic yet. Once resolved rumours (COMPLETED/FAILED/DENIED) pass 200, retrain with `--source db` to fit on real outcomes instead.
- [x] More competitions — Champions League, Europa League, Europa Conference League, UEFA Super Cup (via Sportmonks sync); World Cup still open
- [x] Rumour sourcing — Football Italia and L'Équipe added as RSS providers (2026-08-13), both verified live against real feed URLs (not guessed): `football-italia.net/feed` (English, general football news — same keyword-filtered pattern as the existing BBC/Guardian/Marca feeds) and L'Équipe's mercato-scoped feed `dwh.lequipe.fr/api/edito/rss?path=/Football/Transferts-football/` (French). The French feed needed a real fix, not just a config add: `isTransferRelated()`'s keyword list is English-only, so it silently dropped every real French transfer headline (e.g. "Mercato : le capitaine de Tottenham Cristian Romero vers l'Atlético Madrid…") — added `'mercato'`, verified against real feed items live (35 signals captured on first ingest, correctly excluding the non-transfer French articles mixed into the same feed). Also found and fixed while testing: `upsertJobScheduler()` only adds/updates BullMQ schedulers, it never removes one for a feed renamed or deleted from `RSS_FEEDS` — "Goal.com" and "Football365" schedulers (removed from the source list at some point in the past) were still firing every interval and 404ing forever. `scheduler.ts` now sweeps orphaned `rss-*-recurring` schedulers on every boot.
- [ ] Mobile app — React Native sharing the same API
- [x] Calibrated forecasting pipeline — `backend/src/forecasting/` + `ml-service/app/forecasting/` (2026-08-14). Target: "official confirmation within N days or before the window cutoff", persisted/versioned via `ForecastDefinition`. Baseline model is `LogisticRegression` + isotonic calibration (sklearn, already a dependency — no new framework), time-based train/val/test splits, versioned artifacts (`ModelVersion`). **Critical gate:** `GET /claims/:id/forecast` refuses to display a probability (`INSUFFICIENT_DATA`) unless the current model's `trainingDataSource === 'db'` (real resolved outcomes) — a synthetic model passing a sample-size check is NOT sufficient, verified live with a trained synthetic model + running ml-service still correctly blocked. As of this writing **no probability has ever been displayed**: the dev DB has ~0 resolved `Claim` outcomes (the evidence model itself is brand new), so every trained artifact is synthetic-only, same `MIN_REAL_SAMPLES`-gated situation the existing likelihood model documents. `GET /forecast/model-health` exposes calibration curve/Brier/logLoss transparently regardless. Full writeup: `docs/forecasting-methodology.md`. Train: `cd ml-service && python -m app.forecasting.train_forecast`, then `cd backend && tsx prisma/seedForecastModel.ts` to register it.
- [x] Provenance-first evidence model — `Claim`/`EvidenceItem`/`EvidenceDuplicateCandidate` (2026-08-14, `backend/src/evidence/`), additive alongside the existing Rumour/RawSignal pipeline, new `GET /claims`, `GET /claims/:id` (evidence count, independent-source count, provenance clusters, official confirmation/denial). Source gained tier/journalistHandle/leagueCoverage/manualReviewStatus/profileVersion. **Not wired into live ingestion** — `workers.ts` still only writes Rumour/RawSignal; `ingestEvidenceItem()` (`evidenceService.ts`) is the entry point for a future session to call from the RSS/Sportmonks workers. Deliberately scoped this way: requirement 7's acceptance test ("five articles derived from one original report count as one independent source") is fully verifiable at the service layer against seeded/fixture data without touching `entityMatcher.ts`/`workers.ts` — the highest-risk file in the repo (see `docs/forecasting-audit.md`) — so wiring live ingestion is left as a separate, separately-reviewable change. Migration `20260814012604_add_provenance_evidence_model` ships a hand-written `down.sql` alongside it (Prisma has no down-migration support, and none of the prior 7 migrations had one either — see the migration folder for the manual rollback command). Seed: `tsx prisma/seedEvidence.ts` (after `npm run seed`).
- [x] Evidence-first claim detail UI — `/claim/[id]` (2026-08-14, `frontend/src/components/`): `ForecastCard` (probability only when the model-health gate approves it — otherwise "Insufficient historical data", never a red/amber/green-only encoding), `WhyThisForecast` (top factors derived from the evidence model itself — `independentSourceCount`, not raw article count — since the calibrated model doesn't persist per-feature attribution; each factor links to its supporting `EvidenceItem`), `EvidenceTimeline` (chronological, filterable by official/original/corroboration/syndication/denial/contextual, syndicated copies visually secondary to their shared original), `ProvenanceGraph` (collapsed by default — progressive disclosure, not the first thing shown — real DOM `<button>` nodes with accessible labels and arrow-key navigation between connected nodes rather than reusing the existing Sigma/canvas `TransferGraph`, which has no focusable elements to navigate; automatic list-view mobile fallback plus a manual toggle; credibility shown as "Tier N" text, never a single opaque node colour), `ForecastHistoryChart` (Recharts, uncertainty band, annotated confirmation/denial events, explicit empty state). First frontend tests in the repo — Vitest + Testing Library + jsdom (`frontend/vitest.config.ts`), 77 tests, fixtures in `frontend/src/test/fixtures.ts` covering the same 5-syndication-plus-confirmation scenario as the backend seed, plus a dedicated official-denial scenario the backend seed didn't have. Setting this up surfaced a real cross-package bug: this is an npm workspaces monorepo, and installing test deps scoped inside `frontend/` (rather than from the repo root) desynced the hoisted root `node_modules` and silently resolved `frontend`'s `@testing-library/jest-dom` against **backend's** older, incompatible `vitest` version — unified both packages on the same vitest version to fix it for good, not just for this session (same root-cause class as the `@rollup/rollup-darwin-arm64` optional-deps bug from earlier this project, different trigger).
- [x] Source reliability, outcome detection, contradiction linking (auto hit/miss scoring per source)
- [x] Wikidata player enrichment (nationality/position/age for auto-created players)
- [x] Ads (placeholder slots) + £0.99 remove-ads one-time payment via Stripe
- [x] Sportmonks player/club catalog sync — live, verified against a real key (2026-08-09): 241 clubs / 6,666 players (see below for scope)
- [x] Monetisation entitlement model (2026-08-14, `backend/src/entitlements/`) — three tiers (Free/Pro/Research), a two-layer resolver (minimum tier required **and** an independently-toggleable feature flag, so "not on your plan" and "temporarily disabled" are distinguishable), server-side `requireEntitlement()` gates (never frontend-only), five privacy-conscious `ProductEvent` types with no claim/player IDs on view events, and an `UpgradePrompt` UI stub. Payment processing explicitly out of scope — see `docs/monetisation-proposal.md`, including "why TransferHub must not sell certainty or hide conflicting evidence" (forecasts and evidence, including official denials, are never tier-gated).
- [x] Public-beta security hardening (2026-08-14/15, `backend/src/admin/`, `backend/src/apiKeys/`) — role-based admin access (`requireAdmin`, retiring the shared-secret `ADMIN_TOKEN` stopgap) with an immutable `AdminAuditEvent` trail and rate limiting; real Research-tier API keys (SHA-256-hashed secrets, scoped, owner-listable/admin-revocable, non-enumerating error responses); a daily `ProductEvent` retention purge wired into the existing BullMQ scheduler; and the watchlist free-tier cap's count-then-insert race closed with a Postgres advisory-lock transaction (verified by confirming the concurrency test actually fails with the lock removed before trusting it). See `docs/public-beta-readiness-audit.md`, `docs/admin-operations.md`, `docs/research-api.md`, `docs/data-retention.md`. A parallel principle-of-least-privilege pass (`docs/polp-security-dev-plan.md`) closed the remaining unauthenticated `/admin/*` routes and added an optional shared-secret header between the backend and `ml-service` — both verified live 2026-08-16 (401 with no cookie/key, 200 with).
- [x] Sportmonks rumour sync actually works now (2026-08-16) — it never had, against a real key: three independent bugs found by hitting the live API directly rather than trusting the existing code. (1) Called `/transfers` (entire historical dataset, no recency bound) instead of `/transfers/latest`. (2) Sent `filter[type]=rumour`, which 400s (`"Filters should be passed as a string"`) — there is no `type:rumour` filter on this endpoint at all; "rumour vs confirmed" is the `completed` boolean field on each row, already read by `normalize()`. (3) The response schema required fields (`transfer: boolean`, `type: enum`, `pagination.last_page`) that don't exist in the real payload — would have thrown on `.parse()` even with (1) and (2) fixed. Switched to `/transfers/latest`, dropped the invalid filter, fixed the schema to match a captured-live response, and replaced the `last_page` pagination loop with the real `has_more` cursor field plus a hard 5-page cap (an "always has more" recent-activity feed has no natural end). Verified live end-to-end: 250 real transfers fetched, 4 matched existing players/clubs and became real `Rumour` rows for the first time. `sportmonks.test.ts` added (schema + normalize regression tests against the captured real shape — no test existed before).
- [x] Bug-fix pass from a full-branch code review (2026-08-15): `upsertPlayer` no longer nulls a player's known `contractEnd` when a later Sportmonks sync omits it; French RSS headlines (`L'Équipe`) now actually resolve to a `Rumour` instead of silently producing zero matches (`resolveDirection` learned "quitte X pour Y" alongside the existing "leaves X for Y"); watchlist CSV export escapes leading `=`/`+`/`-`/`@` against formula injection; the instant-alert endpoint no longer logs a product event before confirming the write succeeded (a missing watchlist row now 404s cleanly instead of a bare 500); and re-adding an already-watchlisted player no longer inflates the `WATCHLIST_CREATED` metric.

## Picking this up in a new session

Everything below is code-complete but blocked on external accounts/keys that weren't available this session. All of it degrades gracefully (clear errors, offline no-ops) without them — nothing is broken, it just isn't live yet.

1. **Payments (`backend/src/routes/billing.ts`)** — set a real `STRIPE_SECRET_KEY` in `backend/.env` (test key is fine: dashboard.stripe.com/test/apikeys) to make the "Remove ads — £0.99" flow actually work. Until then `POST /billing/checkout-session` returns a clean 501.

2. **Player/club sync (`backend/src/ingestion/sportmonksCatalog.ts`, `playerClubSync.ts`)** — live and verified (2026-08-09) against a real `SPORTMONKS_API_KEY`, 3 consecutive runs, 241 clubs / 6,666 players each time (idempotent, no drift). Two things worth knowing:
   - **The configured key's plan is "Euro Club Tournaments" (trialing until 2026-08-22)** — scoped to exactly 4 UEFA competitions (Champions League, Europa League, Europa Conference League, UEFA Super Cup), *not* domestic leagues. `TARGET_LEAGUES` in `sportmonksCatalog.ts` reflects this, with real verified league/position IDs (not the earlier placeholder guesses). If the key changes to a domestic-league plan, `TARGET_LEAGUES` needs updating to match — check `GET /leagues?api_token=...` first to see what the new key actually has access to before assuming anything.
   - Also found and fixed a real, pre-existing bug while testing this: `createAxiosClient()` in `sportmonks.ts` was authenticating via a `Bearer` header, but Sportmonks v3 requires `api_token` as a query param — the header approach 401s even with a valid key. This had never been tested against a real key before, so it's been broken since day one; `/transfers` ingestion should also start working now.
   - Club-name dedup fixed (2026-08-09, commit `60cea10`): names now normalized (punctuation/case) before matching, so "Paris Saint-Germain" (seed) and "Paris Saint Germain" (Sportmonks) merge instead of duplicating. Same commit also fixed cross-competition club overwrite (a club in >1 target UEFA competition was losing/duplicating league data) and a 100%-failure country lookup 404 (wrong axios base URL, `/core/countries` needs `/v3/core` not `/v3/football/core`).
   - Re-run manually anytime with `POST /admin/players/sync` rather than waiting for the daily schedule.
   - **Contract-end date now synced (2026-08-13):** the squad-membership `end` field was being fetched and discarded — `Player.contractEnd` stayed null for 5655/5671 players, so the scoring engine's contract-urgency component silently contributed nothing for almost everyone. Now wired through (`sportmonksCatalog.ts` → `playerClubSync.ts`). Caught in review: the zod field was `end: z.string().nullable()`, which requires the key to be *present* (null is fine, but a missing key throws) — a trialist/youth/loan row omitting `end` entirely would have thrown and failed that whole club's sync. Changed to `.nullish()`; added `sportmonksCatalog.test.ts` covering present/null/absent. Verified live: `POST /admin/players/sync` completed clean, 198 clubs / 5378 players, no schema errors, backfilled `contractEnd` on 4517/5692 existing player rows in place via the existing update path (no wipe).

3. **Rumour data quality** — if the `rumours` table ever looks untrustworthy again (wrong club pairings, duplicates, fabricated entities), start by reading `backend/src/ingestion/entityMatcher.ts` top-to-bottom — several rounds of real bugs were found and fixed there by tracing actual ingested headlines through `extractRumoursFromText()` rather than guessing, e.g. via a throwaway `tsx` script. The dev DB can be reset to a clean state at any time with the wipe-and-reseed sequence in git history (see commits `2185235`, `fb1f4b6`, `354f9cb`) — delete `rumour_history`/`rumours`/`raw_signals`/auto-created players+clubs, reset source `hitCount`/`missCount`/`reliabilityScore`, restart the backend to re-ingest.

4. **Auth (`backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts`)** — code-complete and verified end-to-end this session (register/login/logout/me, watchlist add/list/remove, `/rumours?watchlist=true` feed filter — all curl-tested; SSR auth state on `/player/[id]` and `/watchlist` confirmed via cookie-forwarded fetch). Not blocked on anything to *run* — `JWT_SECRET` falls back to a dev default (`middleware/auth.ts`, `controllers/authController.ts`) so it works out of the box locally. Before shipping to anywhere real: set a real `JWT_SECRET` in `backend/.env` (`openssl rand -hex 32`) — the dev fallback signs valid sessions for anyone who reads the source. Chose a plain JWT/httpOnly-cookie flow over NextAuth.js since the backend (Express + Prisma) already owns the DB and every other route — NextAuth's adapter model assumes the Next app owns the session, which would've split auth state across two servers for no benefit here. Scope was deliberately capped at watchlists; notification delivery (email/push) is a separate, still-open roadmap item since it's its own external dependency.
