/**
 * Sportmonks league/squad catalog — separate from sportmonks.ts (which is
 * scoped to /transfers). Populates real Player/Club rows so entityMatcher.ts
 * and upsertNormalizedRumour() have real externalIds to match against,
 * instead of relying on regex-extracted, auto-created guesses.
 *
 * Docs: https://docs.sportmonks.com/football
 *
 * IMPORTANT: the league IDs, endpoint paths and response shapes below are
 * NOT verified against a live account — Sportmonks squad/roster endpoints
 * are commonly gated behind a higher plan tier than /transfers, and exact
 * v3 request/response shapes should be confirmed against real docs or one
 * real call per endpoint before trusting this file with a live key.
 */
import { z } from 'zod'
import { createAxiosClient } from './sportmonks.js'

export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST' | 'CF'

// TODO: verify these against Sportmonks' /leagues listing for your account —
// numeric IDs vary by provider and are not safe to assume from memory.
const TARGET_LEAGUES: Record<string, string> = {
  '8': 'Premier League',
  '564': 'La Liga',
  '82': 'Bundesliga',
  '384': 'Serie A',
  '301': 'Ligue 1',
}

// TODO: verify against the real position taxonomy returned by the squad
// endpoint (`include=position`) — these numeric IDs are placeholders.
const POSITION_ID_MAP: Record<number, Position> = {
  24: 'GK',
  25: 'CB',
  26: 'LB',
  27: 'RB',
  28: 'CDM',
  29: 'CM',
  30: 'CAM',
  31: 'LM',
  32: 'RM',
  33: 'LW',
  34: 'RW',
  35: 'ST',
  36: 'CF',
}

// ─── Provider response shapes (TODO: verify field names against live payloads) ──

const SportmonksTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  short_code: z.string().nullable(),
  image_path: z.string().nullable(),
  country: z.object({ name: z.string() }).nullable().optional(),
})

const SportmonksTeamsResponseSchema = z.object({
  data: z.array(SportmonksTeamSchema),
})

const SportmonksSquadPlayerSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  date_of_birth: z.string().nullable(),
  position_id: z.number().nullable(),
  image_path: z.string().nullable(),
  nationality: z.object({ name: z.string() }).nullable().optional(),
})

const SportmonksSquadResponseSchema = z.object({
  data: z.array(SportmonksSquadPlayerSchema),
})

// ─── Normalized shapes ──────────────────────────────────────────────────────

export interface NormalizedClub {
  externalId: string
  name: string
  shortName: string | null
  league: string
  country: string
  logoUrl: string | null
}

export interface NormalizedPlayer {
  externalId: string
  name: string
  currentClubExternalId: string
  age: number | null
  position: Position | null
  nationality: string | null
  photoUrl: string | null
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null
  const birthDate = new Date(dob)
  if (Number.isNaN(birthDate.getTime())) return null
  return new Date().getFullYear() - birthDate.getFullYear()
}

// Polite delay between the ~105 sequential calls a full sync makes — the
// /transfers pagination loop in sportmonks.ts has no delay because that
// endpoint is much lower volume than a full 5-league squad crawl.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchLeagueTeams(leagueId: string): Promise<NormalizedClub[]> {
  const client = createAxiosClient()
  const league = TARGET_LEAGUES[leagueId]
  const { data: response } = await client.get(`/leagues/${leagueId}`, {
    params: { include: 'currentSeason.teams' },
  })
  const parsed = SportmonksTeamsResponseSchema.parse(response)
  return parsed.data.map((t) => ({
    externalId: `sm-club-${t.id}`,
    name: t.name,
    shortName: t.short_code,
    league,
    country: t.country?.name ?? 'Unknown',
    logoUrl: t.image_path,
  }))
}

async function fetchTeamSquad(teamExternalId: string): Promise<Omit<NormalizedPlayer, 'currentClubExternalId'>[]> {
  const client = createAxiosClient()
  const teamId = teamExternalId.replace('sm-club-', '')
  const { data: response } = await client.get(`/squads/teams/${teamId}`, {
    params: { include: 'position;nationality' },
  })
  const parsed = SportmonksSquadResponseSchema.parse(response)
  return parsed.data.map((p) => ({
    externalId: `sm-player-${p.id}`,
    name: p.display_name,
    age: ageFromDob(p.date_of_birth),
    position: p.position_id ? (POSITION_ID_MAP[p.position_id] ?? null) : null,
    nationality: p.nationality?.name ?? null,
    photoUrl: p.image_path,
  }))
}

/**
 * Fetches every club + player across the target leagues. Returns empty
 * arrays (never throws) if SPORTMONKS_API_KEY is unset, matching the
 * offline-stub pattern used by fetchLatestRumours() in sportmonks.ts.
 */
export async function fetchLeagueCatalog(): Promise<{ clubs: NormalizedClub[]; players: NormalizedPlayer[] }> {
  if (!process.env.SPORTMONKS_API_KEY) {
    console.warn('[sportmonksCatalog] No API key — skipping player/club sync.')
    return { clubs: [], players: [] }
  }

  const clubs: NormalizedClub[] = []
  for (const leagueId of Object.keys(TARGET_LEAGUES)) {
    clubs.push(...(await fetchLeagueTeams(leagueId)))
    await delay(250)
  }

  const players: NormalizedPlayer[] = []
  for (const club of clubs) {
    const squad = await fetchTeamSquad(club.externalId)
    players.push(...squad.map((p) => ({ ...p, currentClubExternalId: club.externalId })))
    await delay(250)
  }

  return { clubs, players }
}
