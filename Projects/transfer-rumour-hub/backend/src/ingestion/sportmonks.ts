/**
 * Sportmonks Transfer Rumours API integration.
 * Docs: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/transfers/get-latest-transfers
 *
 * Set SPORTMONKS_API_KEY in .env. If the key is absent the module falls back
 * to returning stub data so development works offline.
 *
 * 2026-08-16: this integration had never actually worked against a real
 * response — fixed three independent bugs found by hitting the live API
 * directly (docs.sportmonks.com's page content doesn't include field-level
 * detail, only the per-endpoint sub-page does):
 *   1. Wrong endpoint — `/transfers` returns the entire historical dataset
 *      with no recency bound; `/transfers/latest` is the actual "give me
 *      recent activity" endpoint this function's name (fetchLatestRumours)
 *      always claimed to use.
 *   2. Wrong filter param — `filter[type]=rumour` 400s ("Filters should be
 *      passed as a string", code 5010): Sportmonks v3 filters are a single
 *      `filters=name:value` string param, not bracket-object notation, and
 *      there is no "rumour" filter on this endpoint at all — "rumour vs
 *      confirmed" isn't a server-side filter, it's the `completed` boolean
 *      field on each row (already read by normalize() below). No filter
 *      param is sent now; downstream dedup (workers.ts's
 *      upsertNormalizedRumour) already tolerates repeat fetches.
 *   3. Wrong response schema — the real shape has no `transfer`/`type`
 *      fields (neither is used by normalize() below) and pagination is
 *      cursor-style (`has_more: boolean`, no `last_page`) — the old schema
 *      would have rejected every real response via SportmonksResponseSchema
 *      .parse() even with the filter/endpoint bugs fixed.
 */

import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'

// ─── Provider response shape ───────────────────────────────────────────────
// Verified against a live response 2026-08-16, not guessed — extra fields
// Sportmonks might add later are ignored by Zod's default (non-strict)
// object parsing, so this only breaks if a field normalize() reads gets
// renamed or removed.

const SportmonksTransferSchema = z.object({
  id: z.number(),
  player_id: z.number(),
  from_team_id: z.number(),
  to_team_id: z.number(),
  date: z.string().nullable(),
  career_ended: z.boolean(),
  completed: z.boolean(),
  amount: z.number().nullable(),
})

export const SportmonksResponseSchema = z.object({
  data: z.array(SportmonksTransferSchema),
  pagination: z.object({ has_more: z.boolean() }).optional(),
})

// Hard cap, not just a courtesy — `/transfers/latest` has no natural end
// (has_more can stay true indefinitely on an active feed), and this runs
// every RUMOUR_INGEST_INTERVAL_MINUTES. 5 pages × 50/page = 250 of the
// most recent transfers per run is enough to catch up quickly after
// downtime without ever risking an unbounded fetch loop.
const MAX_PAGES = 5

export type SportmonksTransfer = z.infer<typeof SportmonksTransferSchema>

// ─── Normalized shape ──────────────────────────────────────────────────────

export interface NormalizedRumour {
  externalId: string
  playerExternalId: string
  fromClubExternalId: string
  toClubExternalId: string
  reportedFeeMin: number | null
  reportedFeeMax: number | null
  currency: string
  baseProbability: number
  window: 'SUMMER' | 'WINTER' | 'FREE_AGENT'
  rumourDate: Date
}

// ─── Client ───────────────────────────────────────────────────────────────

export function createAxiosClient(): AxiosInstance {
  // Sportmonks v3 authenticates via an `api_token` query param, not a Bearer
  // header — verified against a live key (a Bearer header gets a 401 even
  // with a valid token). Set as an axios default param so every request
  // picks it up without repeating it at each call site.
  return axios.create({
    baseURL: process.env.SPORTMONKS_BASE_URL ?? 'https://api.sportmonks.com/v3/football',
    params: {
      api_token: process.env.SPORTMONKS_API_KEY ?? '',
    },
    timeout: 10_000,
  })
}

function guessWindow(date: Date): NormalizedRumour['window'] {
  const month = date.getMonth() + 1 // 1-indexed
  return month >= 6 && month <= 8 ? 'SUMMER' : 'WINTER'
}

export function normalize(raw: SportmonksTransfer): NormalizedRumour {
  const date = raw.date ? new Date(raw.date) : new Date()
  return {
    externalId: `sm-${raw.id}`,
    playerExternalId: `sm-player-${raw.player_id}`,
    fromClubExternalId: `sm-club-${raw.from_team_id}`,
    toClubExternalId: `sm-club-${raw.to_team_id}`,
    reportedFeeMin: raw.amount ? raw.amount * 0.9 : null,
    reportedFeeMax: raw.amount ? raw.amount * 1.1 : null,
    currency: 'EUR',
    baseProbability: raw.completed ? 1.0 : 0.5,
    window: guessWindow(date),
    rumourDate: date,
  }
}

// ─── Stub data for offline dev ─────────────────────────────────────────────

function stubRumours(): NormalizedRumour[] {
  console.warn('[sportmonks] No API key — returning stub rumours.')
  return [
    {
      externalId: 'stub-001',
      playerExternalId: 'P001',
      fromClubExternalId: 'FCB',
      toClubExternalId: 'MCI',
      reportedFeeMin: 95,
      reportedFeeMax: 115,
      currency: 'EUR',
      baseProbability: 0.68,
      window: 'SUMMER',
      rumourDate: new Date(),
    },
  ]
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function fetchLatestRumours(): Promise<NormalizedRumour[]> {
  if (!process.env.SPORTMONKS_API_KEY) return stubRumours()

  const client = createAxiosClient()
  const results: NormalizedRumour[] = []
  let page = 1

  while (page <= MAX_PAGES) {
    const { data: response } = await client.get('/transfers/latest', {
      params: { page, per_page: 50 },
    })
    const parsed = SportmonksResponseSchema.parse(response)
    results.push(...parsed.data.map(normalize))
    if (!parsed.pagination?.has_more) break
    page++
  }

  return results
}
