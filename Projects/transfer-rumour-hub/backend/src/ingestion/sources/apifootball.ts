/**
 * API-Football (api-sports.io) integration.
 * Endpoint: GET /transfers — returns completed + recent transfers.
 * Key: set API_FOOTBALL_KEY in .env. Falls back to stub if absent.
 * Docs: https://www.api-football.com/documentation-v3#operation/get-transfers
 */
import axios from 'axios'
import { z } from 'zod'
import type { NormalizedRumour } from '../sportmonks.js'

const TransferEntrySchema = z.object({
  player: z.object({ id: z.number(), name: z.string() }),
  update: z.string(),
  transfers: z.array(
    z.object({
      date: z.string(),
      type: z.string(),
      teams: z.object({
        in: z.object({ id: z.number(), name: z.string() }),
        out: z.object({ id: z.number(), name: z.string() }),
      }),
    }),
  ),
})

const ResponseSchema = z.object({
  response: z.array(TransferEntrySchema),
})

function guessWindow(date: Date): NormalizedRumour['window'] {
  const month = date.getMonth() + 1
  return month >= 6 && month <= 8 ? 'SUMMER' : 'WINTER'
}

export async function fetchApiFootballTransfers(leagueId = 39): Promise<NormalizedRumour[]> {
  if (!process.env.API_FOOTBALL_KEY) {
    console.warn('[apifootball] No API key — skipping.')
    return []
  }

  const { data } = await axios.get('https://v3.football.api-sports.io/transfers', {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
    params: { league: leagueId, season: new Date().getFullYear() },
    timeout: 10_000,
  })

  const parsed = ResponseSchema.parse(data)
  const results: NormalizedRumour[] = []

  for (const entry of parsed.response) {
    for (const t of entry.transfers) {
      const date = new Date(t.date)
      results.push({
        externalId: `apf-${entry.player.id}-${t.teams.out.id}-${t.teams.in.id}-${t.date}`,
        playerExternalId: `apf-player-${entry.player.id}`,
        fromClubExternalId: `apf-club-${t.teams.out.id}`,
        toClubExternalId: `apf-club-${t.teams.in.id}`,
        reportedFeeMin: null,
        reportedFeeMax: null,
        currency: 'EUR',
        baseProbability: t.type === 'Free' ? 0.9 : 0.6,
        window: guessWindow(date),
        rumourDate: date,
      })
    }
  }

  return results
}
