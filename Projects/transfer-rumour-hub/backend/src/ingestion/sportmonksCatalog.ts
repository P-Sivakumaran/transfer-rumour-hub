/**
 * Sportmonks league/squad catalog — separate from sportmonks.ts (which is
 * scoped to /transfers). Populates real Player/Club rows so entityMatcher.ts
 * and upsertNormalizedRumour() have real externalIds to match against,
 * instead of relying on regex-extracted, auto-created guesses.
 *
 * League IDs, endpoint shapes, and the position-id taxonomy below were
 * verified against a live account (2026-08-09), not guessed. That account's
 * plan is scoped to UEFA club competitions specifically (see TARGET_LEAGUES)
 * — a domestic-league plan would need different league IDs, but the
 * endpoint/response shapes should carry over.
 */
import { z } from 'zod'
import { createAxiosClient } from './sportmonks.js'

export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST' | 'CF'

// Verified via GET /leagues against the live key — this account's plan is
// "Euro Club Tournaments", scoped to exactly these 4 competitions.
const TARGET_LEAGUES: Record<string, string> = {
  '2': 'Champions League',
  '5': 'Europa League',
  '1328': 'UEFA Super Cup',
  '2286': 'Europa Conference League',
}

// Verified via GET /core/types/{id} for every id observed in real squad
// responses across several clubs. Sportmonks' `detailed_position_id` covers
// 12 of our 13 positions directly; goalkeepers have no detailed variant and
// carry the same id (24) at both position_id and detailed_position_id.
// "Secondary Striker" (163) is a best-effort match to CF — Sportmonks'
// taxonomy doesn't distinguish ST/CF as cleanly as this app's enum does.
const DETAILED_POSITION_MAP: Record<number, Position> = {
  24: 'GK',
  148: 'CB',
  149: 'CDM',
  150: 'CAM',
  151: 'ST',
  152: 'LW',
  153: 'CM',
  154: 'RB',
  155: 'LB',
  156: 'RW',
  157: 'LM',
  158: 'RM',
  163: 'CF',
}

// ─── Provider response shapes (verified against live payloads) ─────────────

const SportmonksTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  short_code: z.string().nullable(),
  image_path: z.string().nullable(),
  country_id: z.number().nullable(),
})

const SportmonksLeagueTeamsResponseSchema = z.object({
  data: z.object({
    currentseason: z
      .object({
        teams: z.array(SportmonksTeamSchema),
      })
      .nullable(),
  }),
})

const SportmonksCountrySchema = z.object({
  data: z.object({ name: z.string() }),
})

// A squad "membership" record — player identity/DOB/nationality only appear
// when `include=player.nationality` is passed (verified; without it, only
// player_id/position_id/contract dates come back).
const SportmonksSquadMemberSchema = z.object({
  player_id: z.number(),
  position_id: z.number().nullable(),
  detailed_position_id: z.number().nullable(),
  player: z.object({
    id: z.number(),
    display_name: z.string(),
    date_of_birth: z.string().nullable(),
    image_path: z.string().nullable(),
    nationality: z.object({ name: z.string() }).nullable(),
  }),
})

const SportmonksSquadResponseSchema = z.object({
  data: z.array(SportmonksSquadMemberSchema),
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

// Polite delay between the ~250-450 sequential calls a full sync makes
// (4 league calls + one per team across ~240 teams) — the /transfers
// pagination loop in sportmonks.ts has no delay because that endpoint is
// much lower volume than a full competition-wide squad crawl.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Countries repeat heavily across teams in the same competition — cache
// resolved names for the lifetime of a single sync run.
const countryNameCache = new Map<number, string>()

async function resolveCountryName(countryId: number | null): Promise<string> {
  if (countryId === null) return 'Unknown'
  const cached = countryNameCache.get(countryId)
  if (cached) return cached

  try {
    const client = createAxiosClient()
    const { data: response } = await client.get(`/core/countries/${countryId}`)
    const parsed = SportmonksCountrySchema.parse(response)
    countryNameCache.set(countryId, parsed.data.name)
    return parsed.data.name
  } catch {
    return 'Unknown'
  }
}

async function fetchLeagueTeams(leagueId: string): Promise<NormalizedClub[]> {
  const client = createAxiosClient()
  const league = TARGET_LEAGUES[leagueId]
  const { data: response } = await client.get(`/leagues/${leagueId}`, {
    params: { include: 'currentSeason.teams' },
  })
  const parsed = SportmonksLeagueTeamsResponseSchema.parse(response)
  const teams = parsed.data.currentseason?.teams ?? []

  const clubs: NormalizedClub[] = []
  for (const t of teams) {
    clubs.push({
      externalId: `sm-club-${t.id}`,
      name: t.name,
      shortName: t.short_code,
      league,
      country: await resolveCountryName(t.country_id),
      logoUrl: t.image_path,
    })
  }
  return clubs
}

async function fetchTeamSquad(teamExternalId: string): Promise<Omit<NormalizedPlayer, 'currentClubExternalId'>[]> {
  const client = createAxiosClient()
  const teamId = teamExternalId.replace('sm-club-', '')
  const { data: response } = await client.get(`/squads/teams/${teamId}`, {
    params: { include: 'player.nationality' },
  })
  const parsed = SportmonksSquadResponseSchema.parse(response)
  return parsed.data.map((m) => {
    const positionId = m.detailed_position_id ?? m.position_id
    return {
      externalId: `sm-player-${m.player.id}`,
      name: m.player.display_name,
      age: ageFromDob(m.player.date_of_birth),
      position: positionId ? (DETAILED_POSITION_MAP[positionId] ?? null) : null,
      nationality: m.player.nationality?.name ?? null,
      photoUrl: m.player.image_path,
    }
  })
}

/**
 * Fetches every club + player across the target competitions. Returns empty
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
