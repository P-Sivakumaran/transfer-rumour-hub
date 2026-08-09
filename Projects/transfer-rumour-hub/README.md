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

### 4. Run together (from root)

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
- [ ] ML scoring service — Python FastAPI + scikit-learn RandomForest trained on historic outcomes
- [x] More competitions — Champions League, Europa League, Europa Conference League, UEFA Super Cup (via Sportmonks sync); World Cup still open
- [ ] Rumour sourcing — scrape additional providers (Football Italia, L'Equipe)
- [ ] Mobile app — React Native sharing the same API
- [x] Source reliability, outcome detection, contradiction linking (auto hit/miss scoring per source)
- [x] Wikidata player enrichment (nationality/position/age for auto-created players)
- [x] Ads (placeholder slots) + £0.99 remove-ads one-time payment via Stripe
- [x] Sportmonks player/club catalog sync — live, verified against a real key (2026-08-09): 241 clubs / 6,666 players (see below for scope)

## Picking this up in a new session

Everything below is code-complete but blocked on external accounts/keys that weren't available this session. All of it degrades gracefully (clear errors, offline no-ops) without them — nothing is broken, it just isn't live yet.

1. **Payments (`backend/src/routes/billing.ts`)** — set a real `STRIPE_SECRET_KEY` in `backend/.env` (test key is fine: dashboard.stripe.com/test/apikeys) to make the "Remove ads — £0.99" flow actually work. Until then `POST /billing/checkout-session` returns a clean 501.

2. **Player/club sync (`backend/src/ingestion/sportmonksCatalog.ts`, `playerClubSync.ts`)** — live and verified (2026-08-09) against a real `SPORTMONKS_API_KEY`, 3 consecutive runs, 241 clubs / 6,666 players each time (idempotent, no drift). Two things worth knowing:
   - **The configured key's plan is "Euro Club Tournaments" (trialing until 2026-08-22)** — scoped to exactly 4 UEFA competitions (Champions League, Europa League, Europa Conference League, UEFA Super Cup), *not* domestic leagues. `TARGET_LEAGUES` in `sportmonksCatalog.ts` reflects this, with real verified league/position IDs (not the earlier placeholder guesses). If the key changes to a domestic-league plan, `TARGET_LEAGUES` needs updating to match — check `GET /leagues?api_token=...` first to see what the new key actually has access to before assuming anything.
   - Also found and fixed a real, pre-existing bug while testing this: `createAxiosClient()` in `sportmonks.ts` was authenticating via a `Bearer` header, but Sportmonks v3 requires `api_token` as a query param — the header approach 401s even with a valid key. This had never been tested against a real key before, so it's been broken since day one; `/transfers` ingestion should also start working now.
   - Club-name dedup fixed (2026-08-09, commit `60cea10`): names now normalized (punctuation/case) before matching, so "Paris Saint-Germain" (seed) and "Paris Saint Germain" (Sportmonks) merge instead of duplicating. Same commit also fixed cross-competition club overwrite (a club in >1 target UEFA competition was losing/duplicating league data) and a 100%-failure country lookup 404 (wrong axios base URL, `/core/countries` needs `/v3/core` not `/v3/football/core`).
   - Re-run manually anytime with `POST /admin/players/sync` rather than waiting for the daily schedule.

3. **Rumour data quality** — if the `rumours` table ever looks untrustworthy again (wrong club pairings, duplicates, fabricated entities), start by reading `backend/src/ingestion/entityMatcher.ts` top-to-bottom — several rounds of real bugs were found and fixed there by tracing actual ingested headlines through `extractRumoursFromText()` rather than guessing, e.g. via a throwaway `tsx` script. The dev DB can be reset to a clean state at any time with the wipe-and-reseed sequence in git history (see commits `2185235`, `fb1f4b6`, `354f9cb`) — delete `rumour_history`/`rumours`/`raw_signals`/auto-created players+clubs, reset source `hitCount`/`missCount`/`reliabilityScore`, restart the backend to re-ingest.

4. **Auth (`backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts`)** — code-complete and verified end-to-end this session (register/login/logout/me, watchlist add/list/remove, `/rumours?watchlist=true` feed filter — all curl-tested; SSR auth state on `/player/[id]` and `/watchlist` confirmed via cookie-forwarded fetch). Not blocked on anything to *run* — `JWT_SECRET` falls back to a dev default (`middleware/auth.ts`, `controllers/authController.ts`) so it works out of the box locally. Before shipping to anywhere real: set a real `JWT_SECRET` in `backend/.env` (`openssl rand -hex 32`) — the dev fallback signs valid sessions for anyone who reads the source. Chose a plain JWT/httpOnly-cookie flow over NextAuth.js since the backend (Express + Prisma) already owns the DB and every other route — NextAuth's adapter model assumes the Next app owns the session, which would've split auth state across two servers for no benefit here. Scope was deliberately capped at watchlists; notification delivery (email/push) is a separate, still-open roadmap item since it's its own external dependency.
