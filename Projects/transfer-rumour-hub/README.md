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

- [ ] Auth (NextAuth.js) — user watchlists and notifications
- [x] SSE hook in frontend — live TruthMeter updates without page refresh
- [x] Admin panel — manually set rumour status (COMPLETED / FAILED / DENIED), gated on linked source evidence
- [ ] ML scoring service — Python FastAPI + scikit-learn RandomForest trained on historic outcomes
- [ ] More competitions — Champions League, World Cup transfers
- [ ] Rumour sourcing — scrape additional providers (Football Italia, L'Equipe)
- [ ] Mobile app — React Native sharing the same API
- [x] Source reliability, outcome detection, contradiction linking (auto hit/miss scoring per source)
- [x] Wikidata player enrichment (nationality/position/age for auto-created players)
- [x] Ads (placeholder slots) + £0.99 remove-ads one-time payment via Stripe
- [ ] Sportmonks player/club catalog sync — code complete, needs a real API key (see below)

## Picking this up in a new session

Everything below is code-complete but blocked on external accounts/keys that weren't available this session. All of it degrades gracefully (clear errors, offline no-ops) without them — nothing is broken, it just isn't live yet.

1. **Payments (`backend/src/routes/billing.ts`)** — set a real `STRIPE_SECRET_KEY` in `backend/.env` (test key is fine: dashboard.stripe.com/test/apikeys) to make the "Remove ads — £0.99" flow actually work. Until then `POST /billing/checkout-session` returns a clean 501.

2. **Player/club sync (`backend/src/ingestion/sportmonksCatalog.ts`, `playerClubSync.ts`)** — set `SPORTMONKS_API_KEY` to populate real players/clubs for the top 5 leagues (currently only ~4 seeded players exist, so most rumour matching still falls back to regex-extraction from headlines). Before trusting this against a real key:
   - Confirm the account's plan actually includes squad/roster endpoints (often gated above the `/transfers` tier already in use).
   - Verify the league IDs in `TARGET_LEAGUES` and the endpoint paths/response shapes against live Sportmonks v3 docs — they're placeholders marked `TODO: verify`, not confirmed values.
   - Run `POST /admin/players/sync` to trigger a sync on demand instead of waiting for the daily schedule, then check `players`/`clubs` row counts and spot-check that seeded rows (`externalId: 'P001'`, `'MCI'`, ...) got adopted rather than duplicated.

3. **Rumour data quality** — if the `rumours` table ever looks untrustworthy again (wrong club pairings, duplicates, fabricated entities), start by reading `backend/src/ingestion/entityMatcher.ts` top-to-bottom — several rounds of real bugs were found and fixed there by tracing actual ingested headlines through `extractRumoursFromText()` rather than guessing, e.g. via a throwaway `tsx` script. The dev DB can be reset to a clean state at any time with the wipe-and-reseed sequence in git history (see commits `2185235`, `fb1f4b6`, `354f9cb`) — delete `rumour_history`/`rumours`/`raw_signals`/auto-created players+clubs, reset source `hitCount`/`missCount`/`reliabilityScore`, restart the backend to re-ingest.
