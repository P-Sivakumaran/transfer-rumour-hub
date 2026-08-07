/**
 * Entity Matcher — extracts player and club mentions from raw text,
 * fuzzy-matches them against the DB, and returns candidate rumour tuples.
 *
 * Auto-creation: when a candidate name extraction confidence > AUTO_CREATE_THRESHOLD
 * and no DB entity matches, a new Player (or Club) row is created automatically.
 *
 * Upgrade path: swap `findBestMatch` for a transformer-based NER model
 * (e.g. spaCy en_core_web_sm served via FastAPI) without changing callers.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Fuzzy helpers ─────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[a.length][b.length]
}

function similarity(a: string, b: string): number {
  const na = normalise(a)
  const nb = normalise(b)
  if (na === nb) return 1
  if (nb.includes(na) || na.includes(nb)) return 0.92
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(na, nb) / maxLen
}

// ─── Name alias map ─────────────────────────────────────────────────────────

const CLUB_ALIASES: Record<string, string> = {
  'man city': 'Manchester City',
  'man utd': 'Manchester United',
  'man united': 'Manchester United',
  'spurs': 'Tottenham',
  'barca': 'FC Barcelona',
  'bvb': 'Borussia Dortmund',
  'inter': 'Inter Milan',
  'psv': 'PSV Eindhoven',
  'ajax': 'Ajax',
  'wolves': 'Wolverhampton',
  'villa': 'Aston Villa',
  'newcastle': 'Newcastle United',
  'west ham': 'West Ham United',
  'chelski': 'Chelsea',
  'arsenal': 'Arsenal',
  'liverpool': 'Liverpool',
}

function resolveAlias(text: string): string {
  const lower = normalise(text)
  return CLUB_ALIASES[lower] ?? text
}

// ─── DB entity cache ─────────────────────────────────────────────────────────

interface EntityCache {
  players: Array<{ id: number; name: string; position: string | null }>
  clubs: Array<{ id: number; name: string; shortName: string | null; league: string }>
}

let cache: EntityCache | null = null
let cacheAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000

async function getEntities(): Promise<EntityCache> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache
  const [players, clubs] = await Promise.all([
    prisma.player.findMany({ select: { id: true, name: true, position: true } }),
    prisma.club.findMany({ select: { id: true, name: true, shortName: true, league: true } }),
  ])
  cache = { players, clubs }
  cacheAt = Date.now()
  return cache
}

export function invalidateEntityCache(): void {
  cache = null
}

// ─── Match functions ────────────────────────────────────────────────────────

const MATCH_THRESHOLD = 0.80
const AUTO_CREATE_THRESHOLD = 0.85

function findBestClub(text: string, clubs: EntityCache['clubs']) {
  const resolved = resolveAlias(text)
  let best = { id: -1, name: '', score: 0 }
  for (const c of clubs) {
    const score = Math.max(
      similarity(resolved, c.name),
      c.shortName ? similarity(resolved, c.shortName) : 0,
    )
    if (score > best.score) best = { id: c.id, name: c.name, score }
  }
  return best.score >= MATCH_THRESHOLD ? best : null
}

// Returns raw best score without threshold — used to detect near-misses
function bestScore(
  text: string,
  entities: Array<{ name: string; shortName?: string | null }>,
): number {
  const resolved = resolveAlias(text)
  let best = 0
  for (const e of entities) {
    const s = Math.max(
      similarity(resolved, e.name),
      e.shortName ? similarity(resolved, e.shortName) : 0,
    )
    if (s > best) best = s
  }
  return best
}

// ─── Candidate name extraction ───────────────────────────────────────────────

const STOP_NAMES = new Set([
  // Transfer / football jargon
  'Transfer', 'Window', 'Premier', 'League', 'Season', 'Summer', 'Winter',
  'January', 'August', 'United', 'City', 'Real', 'Club', 'Football',
  'Champions', 'Europa', 'Conference', 'World', 'Cup', 'International',
  'Breaking', 'Exclusive', 'Report', 'Update', 'Confirmed', 'Official',
  'Deal', 'Move', 'Sign', 'Signs', 'Signed', 'Agreement', 'Contract',
  'Medical', 'Done', 'Close', 'Complete', 'Here', 'Goes', 'According',
  'Source', 'Sources', 'Multiple', 'Reports', 'Latest', 'News',
  'Market', 'Value', 'Million', 'Euro', 'Pound', 'Fee', 'Wage',
  // Player positions
  'Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Striker',
  'Winger', 'Fullback', 'Sweeper', 'Keeper', 'Attacker',
  // Stadiums / venues
  'Cottage', 'Park', 'Stadium', 'Arena', 'Ground', 'Lane', 'Road',
  'Bridge', 'Emirates', 'Anfield', 'Stamford', 'Etihad', 'Trafford',
  // Common journalist / manager tokens
  'Fabrizio', 'Romano', 'Ornstein', 'David', 'Florentino',
  // Club-like words
  'Athletic', 'Sporting', 'Dynamo', 'Atletico', 'Vallecano',
  // Days / nationalities
  'English', 'Spanish', 'German', 'French', 'Italian', 'Dutch',
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
])

const CLUB_SUFFIXES =
  /\b(FC|CF|SC|AFC|RFC|BC|United|City|Athletic|Rovers|Wanderers|Town|County|Rangers|Hotspur|Albion|Palace|Wednesday|Vallecano|Villarreal|Sociedad)\s*$/i

function isProperName(candidate: string): boolean {
  const words = candidate.trim().split(/\s+/)
  if (words.length < 2 || words.length > 3) return false
  if (candidate.length < 5 || candidate.length > 35) return false
  if (!words.every((w) => /^[A-ZÁÉÍÓÚÑÇÜ]/.test(w))) return false
  if (words.some((w) => STOP_NAMES.has(w))) return false
  if (CLUB_SUFFIXES.test(candidate)) return false
  if (/\d/.test(candidate)) return false
  return true
}

const PLAYER_EXTRACTION_PATTERNS = [
  /^([A-Z][a-záéíóúñçüÄÖÜ]+(?:\s[A-Z][a-záéíóúñçüÄÖÜ'-]+){1,2})\s+(?:to|joins?|signs? for|moves? to|heading to|completes? move to|set to join)/,
  /(?:sign(?:s|ed)?|target(?:s|ed)?|eye(?:s|d)?|want(?:s|ed)?|bid(?:s)? for|keen on|chase(?:s|d)?|linked with|interested in|approach(?:ed)?|agree(?:s|d)? deal for|complete(?:s|d)? signing of)\s+([A-Z][a-záéíóúñçüÄÖÜ]+(?:\s[A-Z][a-záéíóúñçüÄÖÜ'-]+){1,2})/,
  /([A-Z][a-záéíóúñçüÄÖÜ]+(?:\s[A-Z][a-záéíóúñçüÄÖÜ'-]+){1,2})\s+(?:completes?|confirms?|announces?|agrees?|passes? medical|here we go)/,
  /[:\-–]\s+([A-Z][a-záéíóúñçüÄÖÜ]+(?:\s[A-Z][a-záéíóúñçüÄÖÜ'-]+){1,2})\s+(?:to|joins?|signs?)/,
]

interface CandidateName {
  name: string
  extractionConfidence: number
}

function extractCandidateNames(text: string): CandidateName[] {
  const found = new Map<string, number>()
  for (const pattern of PLAYER_EXTRACTION_PATTERNS) {
    const m = text.match(pattern)
    if (!m || !m[1]) continue
    const name = m[1].trim()
    if (!isProperName(name)) continue
    const base = 0.90 - PLAYER_EXTRACTION_PATTERNS.indexOf(pattern) * 0.02
    found.set(name, Math.max(found.get(name) ?? 0, base))
  }
  return Array.from(found.entries()).map(([name, extractionConfidence]) => ({
    name,
    extractionConfidence,
  }))
}

function extractClubCandidates(text: string): string[] {
  const patterns = [
    /\b([A-Z][a-z]+ (?:FC|CF|SC|AC|FK|SK|AF))\b/g,
    /\b(FC [A-Z][a-z]+)\b/g,
    /\b([A-Z][a-z]+ (?:United|City|Athletic|Rovers|Wanderers|Town|County|Rangers|Hotspur|Albion|Palace|Wednesday))\b/g,
    /\b((?:Real|Atletico|Sporting|Racing|Deportivo|CA) [A-Z][a-z]+)\b/g,
    /\b((?:Manchester|Newcastle|Nottingham|Wolverhampton|Crystal|Sheffield|Brighton|Leicester|Blackburn) [A-Z][a-z]+)\b/g,
  ]
  const candidates: string[] = []
  for (const p of patterns) {
    let m: RegExpExecArray | null
    while ((m = p.exec(text)) !== null) {
      candidates.push(m[1])
    }
  }
  return [...new Set(candidates)]
}

// ─── Auto-create entities ────────────────────────────────────────────────────

// Per-process in-flight sets prevent concurrent workers creating duplicate rows
// for the same name within the same Node.js process (concurrency: 3 workers).
const inFlightPlayers = new Set<string>()
const inFlightClubs = new Set<string>()

async function autoCreatePlayer(name: string): Promise<number | null> {
  const key = normalise(name)
  if (inFlightPlayers.has(key)) return null
  inFlightPlayers.add(key)
  try {
    // Re-check DB — another worker may have created it between the outer guard and here
    const existing = await prisma.player.findFirst({ where: { name } })
    if (existing) return existing.id
    const player = await prisma.player.create({ data: { name, autoCreated: true } })
    console.log(`[entityMatcher] Auto-created player: "${name}" (id=${player.id})`)
    invalidateEntityCache()
    return player.id
  } finally {
    inFlightPlayers.delete(key)
  }
}

async function autoCreateClub(name: string): Promise<number | null> {
  const key = normalise(name)
  if (inFlightClubs.has(key)) return null
  inFlightClubs.add(key)
  try {
    const existing = await prisma.club.findFirst({ where: { name } })
    if (existing) return existing.id
    const club = await prisma.club.create({
      data: { name, autoCreated: true, league: 'Unknown', country: 'Unknown' },
    })
    console.log(`[entityMatcher] Auto-created club: "${name}" (id=${club.id})`)
    invalidateEntityCache()
    return club.id
  } finally {
    inFlightClubs.delete(key)
  }
}

// ─── Direction resolution ────────────────────────────────────────────────────

const TO_PREPOSITIONS = [' to ', ' joins ', ' signs for ', ' moves to ', ' heading to ']
const FROM_PREPOSITIONS = [' from ', ' leaves ', ' departs ', ' exits ']

function resolveDirection(
  lower: string,
  text: string,
  clubs: EntityCache['clubs'],
  mentionedClubs: Array<{ id: number; name: string; score: number }>,
): { fromClub: (typeof mentionedClubs)[0]; toClub: (typeof mentionedClubs)[0] } {
  let fromClub = mentionedClubs[0]
  let toClub = mentionedClubs[1]

  for (const prep of TO_PREPOSITIONS) {
    const idx = lower.indexOf(prep)
    if (idx === -1) continue
    const afterPrep = text.slice(idx + prep.length, idx + prep.length + 40)
    const best = findBestClub(afterPrep, clubs)
    if (best) toClub = { id: best.id, name: best.name, score: best.score }
  }

  for (const prep of FROM_PREPOSITIONS) {
    const idx = lower.indexOf(prep)
    if (idx === -1) continue
    const afterPrep = text.slice(idx + prep.length, idx + prep.length + 40)
    const best = findBestClub(afterPrep, clubs)
    if (best) fromClub = { id: best.id, name: best.name, score: best.score }
  }

  return { fromClub, toClub }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface MatchedRumour {
  playerId: number
  playerName: string
  fromClubId: number
  fromClubName: string
  toClubId: number
  toClubName: string
  headline: string
  confidence: number
  autoCreated?: boolean
}

export async function extractRumoursFromText(
  headline: string,
  summary: string,
): Promise<MatchedRumour[]> {
  const { players, clubs } = await getEntities()
  const text = `${headline} ${summary}`
  const lower = text.toLowerCase()
  const results: MatchedRumour[] = []

  // ── Strategy 1: match existing DB players ──────────────────────────────────
  for (const player of players) {
    const lastName = normalise(player.name).split(' ').pop()
    if (!lastName || !normalise(text).includes(lastName)) continue

    const playerScore = similarity(player.name, text)
    if (playerScore < 0.75) continue

    const mentionedClubs: Array<{ id: number; name: string; score: number }> = []
    for (const club of clubs) {
      const clubScore = Math.max(
        similarity(text, club.name),
        club.shortName ? similarity(text, club.shortName) : 0,
      )
      if (clubScore >= MATCH_THRESHOLD) mentionedClubs.push({ ...club, score: clubScore })
    }

    if (mentionedClubs.length < 2) continue

    const { fromClub, toClub } = resolveDirection(lower, text, clubs, mentionedClubs)
    if (fromClub.id === toClub.id) continue

    results.push({
      playerId: player.id,
      playerName: player.name,
      fromClubId: fromClub.id,
      fromClubName: fromClub.name,
      toClubId: toClub.id,
      toClubName: toClub.name,
      headline,
      confidence: (playerScore + fromClub.score + toClub.score) / 3,
    })
  }

  // ── Strategy 2: extract unknown players from headline patterns ─────────────
  const candidates = extractCandidateNames(headline)

  for (const candidate of candidates) {
    if (candidate.extractionConfidence < AUTO_CREATE_THRESHOLD) continue

    const alreadyMatched = results.some(
      (r) => similarity(r.playerName, candidate.name) >= MATCH_THRESHOLD,
    )
    if (alreadyMatched) continue

    const closestPlayerScore = bestScore(candidate.name, players)
    if (closestPlayerScore >= 0.70) continue

    const closestClubScore = bestScore(candidate.name, clubs)
    if (closestClubScore >= 0.65) continue

    const newPlayerId = await autoCreatePlayer(candidate.name)
    if (newPlayerId === null) continue // another worker is handling this name

    // Re-fetch once after player creation; reuse for the rest of this candidate
    const freshEntities = await getEntities()
    const freshClubs = freshEntities.clubs

    const mentionedClubs: Array<{ id: number; name: string; score: number }> = []
    for (const club of freshClubs) {
      const clubScore = Math.max(
        similarity(headline, club.name),
        club.shortName ? similarity(headline, club.shortName) : 0,
      )
      if (clubScore >= MATCH_THRESHOLD) mentionedClubs.push({ ...club, score: clubScore })
    }

    if (mentionedClubs.length < 2) {
      const clubCandidates = extractClubCandidates(headline)
      for (const clubName of clubCandidates) {
        const existing = findBestClub(clubName, freshClubs)
        if (existing) {
          if (!mentionedClubs.find((c) => c.id === existing.id)) {
            mentionedClubs.push({ id: existing.id, name: existing.name, score: existing.score })
          }
          continue
        }
        if (bestScore(clubName, freshClubs) < 0.70) {
          const newClubId = await autoCreateClub(clubName)
          if (newClubId !== null) {
            // Use the name we passed in — no extra DB round-trip needed
            mentionedClubs.push({ id: newClubId, name: clubName, score: 0.90 })
          }
        }
      }
    }

    if (mentionedClubs.length < 2) continue

    // freshClubs is already current (includes any clubs auto-created above via getEntities)
    const headlineLower = headline.toLowerCase()
    const { fromClub, toClub } = resolveDirection(
      headlineLower,
      headline,
      // Merge freshClubs with mentionedClubs for direction resolution
      freshClubs,
      mentionedClubs,
    )
    if (fromClub.id === toClub.id) continue

    results.push({
      playerId: newPlayerId,
      playerName: candidate.name,
      fromClubId: fromClub.id,
      fromClubName: fromClub.name,
      toClubId: toClub.id,
      toClubName: toClub.name,
      headline,
      confidence: candidate.extractionConfidence,
      autoCreated: true,
    })
  }

  return results
}
