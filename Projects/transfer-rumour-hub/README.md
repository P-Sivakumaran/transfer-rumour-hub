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
- [ ] SSE hook in frontend — live TruthMeter updates without page refresh
- [ ] Admin panel — manually set rumour status (COMPLETED / FAILED)
- [ ] ML scoring service — Python FastAPI + scikit-learn RandomForest trained on historic outcomes
- [ ] More competitions — Champions League, World Cup transfers
- [ ] Rumour sourcing — scrape additional providers (Football Italia, L'Equipe)
- [ ] Mobile app — React Native sharing the same API
