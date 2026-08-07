/**
 * Sportmonks Transfer Rumours API integration.
 * Docs: https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/transfers
 *
 * Set SPORTMONKS_API_KEY in .env. If the key is absent the module falls back
 * to returning stub data so development works offline.
 */

import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'

// ─── Provider response shape ───────────────────────────────────────────────

const SportmonksTransferSchema = z.object({
  id: z.number(),
  player_id: z.number(),
  from_team_id: z.number(),
  to_team_id: z.number(),
  transfer: z.boolean(),
  type: z.enum(['transfer', 'loan', 'free']),
  date: z.string().nullable(),
  career_ended: z.boolean(),
  completed: z.boolean(),
  amount: z.number().nullable(),
})

const SportmonksResponseSchema = z.object({
  data: z.array(SportmonksTransferSchema),
  pagination: z.object({ current_page: z.number(), last_page: z.number() }).optional(),
})

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

function createAxiosClient(): AxiosInstance {
  return axios.create({
    baseURL: process.env.SPORTMONKS_BASE_URL ?? 'https://api.sportmonks.com/v3/football',
    headers: {
      Authorization: `Bearer ${process.env.SPORTMONKS_API_KEY ?? ''}`,
    },
    timeout: 10_000,
  })
}

function guessWindow(date: Date): NormalizedRumour['window'] {
  const month = date.getMonth() + 1 // 1-indexed
  return month >= 6 && month <= 8 ? 'SUMMER' : 'WINTER'
}

function normalize(raw: SportmonksTransfer): NormalizedRumour {
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

  while (true) {
    const { data: response } = await client.get('/transfers', {
      params: { page, per_page: 50, 'filter[type]': 'rumour' },
    })
    const parsed = SportmonksResponseSchema.parse(response)
    results.push(...parsed.data.map(normalize))
    if (!parsed.pagination || page >= parsed.pagination.last_page) break
    page++
  }

  return results
}
