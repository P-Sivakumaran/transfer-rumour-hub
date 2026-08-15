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

// NFD + strip combining marks folds "ã" to "a" (not delete-to-nothing).
// Length-preserving — every accented character collapses back to exactly one
// base character, so offsets into the result still line up with the source
// string. Used where callers need to locate a substring position, not just
// compare for equality (see foldAccents below).
function stripCombiningMarks(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Case-folded version of stripCombiningMarks, for indexOf against text whose
// positions must still map back to the original (non-folded) string.
function foldAccents(s: string): string {
  return stripCombiningMarks(s).toLowerCase()
}

// Otherwise "Guimarães" (DB spelling) normalises to "guimares" while
// "Guimaraes" (the ASCII transliteration nearly every headline actually uses)
// normalises to "guimaraes", and the two never match.
function normalise(s: string): string {
  return stripCombiningMarks(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
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

// Whole-token containment: does `needle` appear in `haystack` as a standalone
// word/phrase, not as a run of characters inside a longer word. Without this,
// a short club nickname like "Inter" false-matches inside "interest".
function containsWholeToken(haystack: string, needle: string): boolean {
  if (!needle) return false
  return new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(haystack)
}

function similarity(a: string, b: string): number {
  const na = normalise(a)
  const nb = normalise(b)
  if (na === nb) return 1
  if (containsWholeToken(nb, na) || containsWholeToken(na, nb)) return 0.92
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

export { getEntities }

// ─── Match functions ────────────────────────────────────────────────────────

const MATCH_THRESHOLD = 0.80
const AUTO_CREATE_THRESHOLD = 0.85

// Strategy 1 otherwise only requires 2 club mentions + a directional
// preposition near a player's name — generic prose ("...defeat to Hibernian
// compounded by striker Youssef Chermiti...") satisfies that with zero
// transfer content. Deliberately excludes bare "sign"/"signing": a nearby
// mention of someone else's signing (common in aggregator digests and match
// reports alike) would let an unrelated article through.
const TRANSFER_CONTEXT_KEYWORDS =
  /\b(transfer|sign(?:s|ed)? for|joins?|joined|joining|moves? to|moved to|deal|bid|target(?:ed|s)?|linked|rumou?r|loan|medical|hijack|swoop|agreement|agrees? (?:a )?deal|chase(?:s|d)?|keen on|interested in|approach(?:ed)?)\b/i

// Radius (chars) around a player mention searched for TRANSFER_CONTEXT_KEYWORDS.
// Tighter than the 150-char club-matching window on purpose — that window is
// wide enough to span into an unrelated adjacent sentence in a long article,
// which would let this gate pass on the wrong sentence's content.
const TRANSFER_CONTEXT_RADIUS = 60

// Picks the closest qualifying club to the start of `text`, not just the
// highest-scoring one. Callers pass a short slice right after a directional
// preposition ("... from X", "... to Y") that can still contain a second,
// later club mention (headline+summary concatenation repeats names) — without
// a proximity tie-break, an unrelated later mention with an equal exact-match
// score can beat the club that's actually adjacent to the preposition.
function findBestClub(text: string, clubs: EntityCache['clubs']) {
  const resolved = resolveAlias(text)
  const normalisedText = normalise(text)
  let best: { id: number; name: string; score: number; pos: number } | null = null
  for (const c of clubs) {
    const nameScore = similarity(resolved, c.name)
    const shortScore = c.shortName ? similarity(resolved, c.shortName) : 0
    const usingShort = shortScore > nameScore
    const score = usingShort ? shortScore : nameScore
    if (score < MATCH_THRESHOLD) continue

    const label = usingShort ? c.shortName! : c.name
    const rawPos = normalisedText.indexOf(normalise(label))
    const pos = rawPos === -1 ? Infinity : rawPos

    if (!best || pos < best.pos || (pos === best.pos && score > best.score)) {
      best = { id: c.id, name: c.name, score, pos }
    }
  }
  return best
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
  if (!words.every((w) => /^\p{Lu}/u.test(w))) return false
  if (words.some((w) => STOP_NAMES.has(w))) return false
  if (CLUB_SUFFIXES.test(candidate)) return false
  if (/\d/.test(candidate)) return false
  return true
}

// \p{L} (unicode "Letter") covers all diacritics (ã, õ, ø, ß...) — a plain
// [a-záéíóúñçü] class silently truncates names like "Guimarães" at the ã.
const NAME_WORD = `\\p{Lu}[\\p{L}'-]+`
const NAME = `${NAME_WORD}(?:\\s${NAME_WORD}){1,2}`

// Trailing alternatives need a word boundary — without it "to" matches the
// first two letters of "told" ("Mikel Arteta **told** Arsenal winger...",
// a manager relaying news about someone else, misread as "Arteta to
// [destination]"), same for "joins"/"signs" inside a longer unrelated word.
const PLAYER_EXTRACTION_PATTERNS = [
  new RegExp(`^(${NAME})\\s+(?:to|joins?|signs? for|moves? to|heading to|completes? move to|set to join)\\b`, 'u'),
  new RegExp(`(?:sign(?:s|ed)?|target(?:s|ed)?|eye(?:s|d)?|want(?:s|ed)?|bid(?:s)? for|keen on|chase(?:s|d)?|linked with|interested in|approach(?:ed)?|agree(?:s|d)? deal for|complete(?:s|d)? signing of)\\s+(${NAME})`, 'u'),
  new RegExp(`(${NAME})\\s+(?:completes?|confirms?|announces?|agrees?|passes? medical|here we go)`, 'u'),
  new RegExp(`[:\\-–]\\s+(${NAME})\\s+(?:to|joins?|signs?)\\b`, 'u'),
]

// Radius (chars) searched right after a pattern match for the two guards below.
const MANAGER_LOOKAHEAD_RADIUS = 40

// "X confirms/agrees/announces Y ..." where Y is itself a proper name right
// after the trigger is X making a statement about Y, not X being the
// transfer subject ("Diego Simeone confirms Julian Alvarez transfer
// 'decision'" — Simeone is Atlético's manager, Alvarez is the real subject).
// Only pattern 3 (NAME-then-trigger) is ambiguous this way; patterns 1/2/4
// already have the subject on the NAME side of the trigger, not the other.
const NAME_ONLY = new RegExp(NAME, 'u')

// Managerial appointments share transfer-adjacent vocabulary ("agrees",
// "here we go") but aren't player transfers ("Ruben Amorim agrees to become
// AC Milan boss").
const MANAGERIAL_APPOINTMENT = /\b(boss|manager|head coach|assistant coach|director of football|sporting director|technical director)\b/i

interface CandidateName {
  name: string
  extractionConfidence: number
}

// A leading possessive ("Inter's Pio Esposito", "Man City's Dias") is a club
// owning/scouting the player, not part of their name — the
// apostrophe-continuation in NAME_WORD (needed for real names like "N'Golo"
// or "D'Ambrosio") also happens to match this. Strip a leading "X's " or
// "X Y's " (two-word club names) before validating the candidate; NAME's own
// 3-word cap means a 2-word possessive prefix can otherwise consume the
// entire match and leave nothing of the actual player name captured at all.
const LEADING_POSSESSIVE = /^(?:\p{Lu}[\p{L}]*\s+)?\p{Lu}[\p{L}]*'s\s+/u

// A nationality/country name immediately followed by a position word
// ("Northern Ireland midfielder", "Ivory Coast defender") is a descriptive
// clause, not a person's name — NAME's greedy 3-word cap grabs the
// nationality phrase and stops short of the real surname further in the
// sentence. Reuses the position-word list already in STOP_NAMES.
const POSITION_WORD_FOLLOWING =
  /^\s*(goalkeeper|defender|midfielder|forward|striker|winger|fullback|sweeper|keeper|attacker)\b/i

export function extractCandidateNames(text: string): CandidateName[] {
  const found = new Map<string, number>()
  for (const pattern of PLAYER_EXTRACTION_PATTERNS) {
    const m = text.match(pattern)
    if (!m || !m[1] || m.index === undefined) continue
    const name = m[1].trim().replace(LEADING_POSSESSIVE, '')
    if (!isProperName(name)) continue

    const lookahead = text.slice(m.index + m[0].length, m.index + m[0].length + MANAGER_LOOKAHEAD_RADIUS)

    if (POSITION_WORD_FOLLOWING.test(lookahead)) continue

    if (pattern === PLAYER_EXTRACTION_PATTERNS[2]) {
      const otherNameMatch = lookahead.match(NAME_ONLY)
      if (otherNameMatch && isProperName(otherNameMatch[0])) continue
    }

    if (MANAGERIAL_APPOINTMENT.test(lookahead)) continue

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

// French cues added for L'Équipe's mercato feed (isTransferRelated's
// 'mercato' keyword, rss.ts) — without these, that feed's headlines pass
// the topic filter and get written as RawSignal rows but never resolve to
// an actual Rumour, since this cue list is the only thing that assigns a
// direction. Kept deliberately narrow (no bare 'pour' — see the
// quitte-X-pour-Y block below) since these cues are scoped to
// candidateClubs (only clubs already confirmed mentioned nearby), which
// bounds the false-positive risk of a common word like 'rejoint'/'quitte'
// the same way the English cues are already bounded.
const TO_PREPOSITIONS = [' to ', ' joins ', ' signs for ', ' moves to ', ' heading to ', ' rejoint ']
const FROM_PREPOSITIONS = [' from ', ' leaves ', ' leave ', ' departs ', ' exits ', ' quitte ', ' quittent ']

// Verbs that commonly follow a bare " to " as an infinitive marker rather
// than a destination ("Romero **to leave** Spurs for Arsenal") — without this
// guard, findBestClub scans past the verb and grabs whatever club happens to
// be nearest in the lookahead window, which is not necessarily the real
// destination.
// "replace"/"hijack"/"bid" belong here too: "linked ... to replace Morgan
// Rogers", "backed to hijack ... Liverpool transfer", and "set to bid £70m
// for Newcastle midfielder" are the same infinitive construction — X is not
// the destination of a " to " cue, it's the object of a verb. Missing these
// produced three confirmed-wrong rumours (98, a mononym-fix-induced
// regression on signal 7196, and a live one on a fresh post-wipe re-ingest —
// see entityMatcher.replay.ts).
const TO_INFINITIVE_VERBS =
  /^(leave|leaves|join|joins|sign|signs|complete|completes|become|becomes|move|moves|head|heads|make|makes|watch|watching|monitor|monitoring|scout|scouting|track|tracking|assess|assessing|replace|replaces|hijack|hijacks|bid|bids|bidding)\b/i

// "Reports/news/sources **from** X" attributes the story to a publication,
// not a transfer origin — the same bare " from " cue that catches a real
// "signs from Club" also matches this unrelated construction.
const FROM_ATTRIBUTION_PRECEDING = /\b(reports?|news|sources?|according)\s*$/i

// Only assigns a from/to club when the text gives an explicit directional cue
// ("joins X", "from Y") near a club mention. When neither slot resolves this
// way, we return null rather than guess from mention order — a rumour with a
// fabricated direction is worse than no rumour.
export function resolveDirection(
  lower: string,
  text: string,
  clubs: EntityCache['clubs'],
  mentionedClubs: Array<{ id: number; name: string; score: number }>,
): {
  fromClub: (typeof mentionedClubs)[0] | null
  toClub: (typeof mentionedClubs)[0] | null
  fromClubInferred: boolean
} {
  let fromClub: (typeof mentionedClubs)[0] | null = null
  let toClub: (typeof mentionedClubs)[0] | null = null

  // Directional-cue lookups below must only resolve to one of the two clubs
  // Strategy 1/2 already vetted as actually mentioned near this player — not
  // the whole club table. A fixed-width slice (afterPrep, 40 chars) can cut a
  // word in half, and the truncated fragment can coincidentally whole-token
  // match some unrelated club's short code (e.g. "...Daily Mirror Ast" from a
  // duplicated headline+summary matched Astana's "AST" — rumour 98). Scoping
  // to mentionedClubs makes that class of coincidence impossible: the slice
  // can now only ever resolve to one of the two clubs already confirmed present.
  //
  // Built from mentionedClubs rather than filtering `clubs`: Strategy 2's
  // caller (below) can pass a `clubs` snapshot taken before an auto-created
  // club was added to it, so that club would be missing from a filter — but
  // it's always present in mentionedClubs. Falls back to a minimal synthesized
  // record (name only, no shortName) when `clubs` doesn't have it yet.
  const candidateClubs: EntityCache['clubs'] = mentionedClubs.map(
    (m) => clubs.find((c) => c.id === m.id) ?? { id: m.id, name: m.name, shortName: null, league: 'Unknown' },
  )

  // "leave X for Y" — very common transfer-journalism phrasing where X is the
  // origin and Y (after "for") is the destination. Resolved first because the
  // generic " to " cue below would otherwise misfire on "PLAYER **to** leave".
  //
  // "quitte X pour Y" is the French equivalent of the same construction
  // (L'Équipe's mercato feed — see rss.ts's 'mercato' keyword) and is
  // handled here rather than as bare entries in TO_PREPOSITIONS/
  // FROM_PREPOSITIONS: a standalone 'pour' cue is too common a word to be a
  // safe generic destination marker, but paired with 'quitte' as the origin
  // marker (same bounded-window structure as the English case) it's as
  // precise as "leave X for Y" already is.
  const leaveIdx = lower.search(/\bleaves?\b/)
  const quitteIdx = lower.search(/\bquitte(nt)?\b/)
  const originIdx = leaveIdx !== -1 ? leaveIdx : quitteIdx
  const destMarker = leaveIdx !== -1 ? ' for ' : ' pour '
  if (originIdx !== -1) {
    const forIdx = lower.indexOf(destMarker, originIdx)
    if (forIdx !== -1 && forIdx - originIdx < 80) {
      const leaveClub = findBestClub(text.slice(originIdx, forIdx), candidateClubs)
      const forClub = findBestClub(text.slice(forIdx + destMarker.length, forIdx + destMarker.length + 40), candidateClubs)
      if (leaveClub) fromClub = { id: leaveClub.id, name: leaveClub.name, score: leaveClub.score }
      if (forClub) toClub = { id: forClub.id, name: forClub.name, score: forClub.score }
    }
  }

  if (!toClub) {
    for (const prep of TO_PREPOSITIONS) {
      const idx = lower.indexOf(prep)
      if (idx === -1) continue
      const afterPrep = text.slice(idx + prep.length, idx + prep.length + 40)
      if (prep === ' to ' && TO_INFINITIVE_VERBS.test(afterPrep)) continue
      const best = findBestClub(afterPrep, candidateClubs)
      if (best) { toClub = { id: best.id, name: best.name, score: best.score }; break }
    }
  }

  if (!fromClub) {
    for (const prep of FROM_PREPOSITIONS) {
      const idx = lower.indexOf(prep)
      if (idx === -1) continue
      if (prep === ' from ' && FROM_ATTRIBUTION_PRECEDING.test(lower.slice(Math.max(0, idx - 20), idx))) continue
      const afterPrep = text.slice(idx + prep.length, idx + prep.length + 40)
      const best = findBestClub(afterPrep, candidateClubs)
      if (best) { fromClub = { id: best.id, name: best.name, score: best.score }; break }
    }
  }

  // Exactly two clubs in play and only one side resolved explicitly — the
  // other slot is unambiguous by elimination (e.g. "signs for Chelsea" with
  // the old club named earlier but not via an explicit "from" phrase). This
  // is a weaker claim than an explicit cue: "the other mentioned club" is
  // only actually the origin if both clubs belong to the same story (see
  // rumour 135 — a digest headline can put two *unrelated* clubs in
  // mentionedClubs). Callers should treat an elimination-derived fromClub as
  // unconfirmed and prefer the player's real current club when they disagree.
  let fromClubInferred = false
  if (mentionedClubs.length === 2) {
    if (toClub && !fromClub) {
      fromClub = mentionedClubs.find((c) => c.id !== toClub!.id) ?? null
      fromClubInferred = fromClub !== null
    }
    if (fromClub && !toClub) toClub = mentionedClubs.find((c) => c.id !== fromClub!.id) ?? null
  }

  return { fromClub, toClub, fromClubInferred }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface MatchedRumour {
  playerId: number
  playerName: string
  fromClubId: number
  fromClubName: string
  fromClubInferred: boolean
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
  // Same length as `text` (see foldAccents) — positions found in here map
  // directly onto `text` for slicing, unlike a plain toLowerCase() which
  // won't contain a match at all when the DB name is accented but the
  // source text isn't (e.g. DB "Guimarães" vs. headline's ASCII "Guimaraes").
  const foldedLower = foldAccents(text)
  const normalisedText = normalise(text)
  const results: MatchedRumour[] = []

  // ── Strategy 1: match existing DB players ──────────────────────────────────
  for (const player of players) {
    const lastName = normalise(player.name).split(' ').pop()
    if (!lastName || !containsWholeToken(normalisedText, lastName)) continue

    // A mononym's "last name" is its whole name, so the check above matches
    // any text mentioning ANY player who happens to share that first name —
    // e.g. "Bruno" (id 2425, a real distinct Sportmonks mononym) matching
    // text that's actually about "Bruno Guimarães" (id 12), because "Bruno"
    // is a standalone whole token inside "Bruno Guimarães" too. Defer to the
    // fuller name when one is actually present in the text.
    if (!player.name.includes(' ')) {
      const fullerNamePresent = players.some(
        (p2) =>
          p2.id !== player.id &&
          normalise(p2.name).startsWith(`${lastName} `) &&
          containsWholeToken(normalisedText, normalise(p2.name)),
      )
      if (fullerNamePresent) continue
    }

    const playerScore = similarity(player.name, text)
    if (playerScore < 0.75) continue

    // Scope club matching to the text around the player's mention rather than
    // the whole article — otherwise any club namedropped anywhere in a long
    // summary (e.g. an unrelated pundit aside) gets treated as part of this
    // player's transfer. Falls back to the full text if we can't locate the
    // raw (possibly-accented) last name verbatim.
    const rawLastName = player.name.trim().split(/\s+/).pop() ?? ''
    const mentionIdx = rawLastName ? foldedLower.indexOf(foldAccents(rawLastName)) : -1

    // Require actual transfer vocabulary near the mention — 2 club names plus
    // a bare "to"/"from" is common in ordinary match-report prose and isn't
    // evidence of transfer news on its own (see rumour 94: "...defeat to
    // Hibernian compounded by striker Youssef Chermiti being carried off...").
    if (mentionIdx !== -1) {
      const gateWindow = text.slice(
        Math.max(0, mentionIdx - TRANSFER_CONTEXT_RADIUS),
        Math.min(text.length, mentionIdx + rawLastName.length + TRANSFER_CONTEXT_RADIUS),
      )
      if (!TRANSFER_CONTEXT_KEYWORDS.test(gateWindow)) continue
    }

    const w150Start = Math.max(0, mentionIdx - 150)
    const w150End = Math.min(text.length, mentionIdx + rawLastName.length + 150)
    const window150 = mentionIdx === -1 ? text : text.slice(w150Start, w150End)
    // foldAccents doesn't change string length, so this slices to the exact
    // same span as window150 — safe to search in for the same mention.
    const window150Folded = mentionIdx === -1 ? foldedLower : foldedLower.slice(w150Start, w150End)

    // Aggregator digests join several unrelated one-line stories with commas,
    // " - ", or (for "roundup" question-style headlines) "?"/"!" ("Rashford
    // bombshell, Rodri to Barcelona, Arsenal update" / "Balogun to Spurs?
    // Pedro Neto to Manchester City?"), and 150 chars is wide enough to span
    // into a neighbouring story — without this, the 2-club elimination
    // fallback below can pair a club from a different headline fragment as
    // if it were this player's from/to club (rumour 135: Balogun's fromClub
    // resolved to Man City, which was actually Neto's toClub in the very
    // next mini-headline). Narrow to just the delimited clause that actually
    // contains the mention.
    //
    // The right-side "?"/"!" cut only fires when the clause up to that point
    // already contains an explicit directional cue ("to"/"joins"/"from"/...).
    // A bare rhetorical question mark ending a headline ("Could Spurs captain
    // Romero join Arsenal?") is not a digest boundary — rumour 88 resolves
    // its direction from a coincidental " to " further into the summary
    // prose that follows, and cutting there unconditionally starved it of
    // that text. Digest separators, by contrast, always look like "<Name> to
    // <Club>?" — the cue precedes the punctuation.
    const DIRECTION_CUES = [...TO_PREPOSITIONS, ...FROM_PREPOSITIONS]
    const windowText = ((): string => {
      const mIdx = rawLastName ? window150Folded.indexOf(foldAccents(rawLastName)) : -1
      if (mIdx === -1) return window150
      const left =
        Math.max(
          window150.lastIndexOf(',', mIdx),
          window150.lastIndexOf(' - ', mIdx),
          window150.lastIndexOf('?', mIdx),
          window150.lastIndexOf('!', mIdx),
        ) + 1
      let right = window150.length
      const rightComma = window150.indexOf(',', mIdx)
      if (rightComma !== -1) right = Math.min(right, rightComma)
      const rightDash = window150.indexOf(' - ', mIdx)
      if (rightDash !== -1) right = Math.min(right, rightDash)
      for (const punct of ['?', '!']) {
        const rightPunct = window150.indexOf(punct, mIdx)
        if (rightPunct === -1) continue
        const clauseLower = window150.slice(mIdx, rightPunct).toLowerCase()
        if (DIRECTION_CUES.some((cue) => clauseLower.includes(cue))) {
          right = Math.min(right, rightPunct)
        }
      }
      return window150.slice(left, right)
    })()
    const windowLower = windowText.toLowerCase()

    const mentionedClubs: Array<{ id: number; name: string; score: number }> = []
    for (const club of clubs) {
      const clubScore = Math.max(
        similarity(windowText, club.name),
        club.shortName ? similarity(windowText, club.shortName) : 0,
      )
      if (clubScore >= MATCH_THRESHOLD) mentionedClubs.push({ ...club, score: clubScore })
    }

    if (mentionedClubs.length < 2) continue

    const { fromClub, toClub, fromClubInferred } = resolveDirection(windowLower, windowText, clubs, mentionedClubs)
    if (!fromClub || !toClub || fromClub.id === toClub.id) continue

    results.push({
      playerId: player.id,
      playerName: player.name,
      fromClubId: fromClub.id,
      fromClubName: fromClub.name,
      fromClubInferred,
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

    // Determine club mentions BEFORE creating anything. Auto-creating the
    // player first meant every candidate that later failed the club-count
    // check (line below) still left a permanent bogus Player row behind —
    // e.g. "Andoni Iraola confirms Liverpool transfer priority" (Liverpool's
    // manager, one club mentioned, no rumour possible) recreated that exact
    // row on every fresh ingest even after the extraction-pattern fixes.
    const mentionedClubs: Array<{ id: number; name: string; score: number }> = []
    for (const club of clubs) {
      const clubScore = Math.max(
        similarity(headline, club.name),
        club.shortName ? similarity(headline, club.shortName) : 0,
      )
      if (clubScore >= MATCH_THRESHOLD) mentionedClubs.push({ ...club, score: clubScore })
    }

    if (mentionedClubs.length < 2) {
      const clubCandidates = extractClubCandidates(headline)
      for (const clubName of clubCandidates) {
        const existing = findBestClub(clubName, clubs)
        if (existing) {
          if (!mentionedClubs.find((c) => c.id === existing.id)) {
            mentionedClubs.push({ id: existing.id, name: existing.name, score: existing.score })
          }
          continue
        }
        if (bestScore(clubName, clubs) < 0.70) {
          const newClubId = await autoCreateClub(clubName)
          if (newClubId !== null) {
            // Use the name we passed in — no extra DB round-trip needed
            mentionedClubs.push({ id: newClubId, name: clubName, score: 0.90 })
          }
        }
      }
    }

    if (mentionedClubs.length < 2) continue

    const newPlayerId = await autoCreatePlayer(candidate.name)
    if (newPlayerId === null) continue // another worker is handling this name

    // Re-fetch once after player (and possibly club) creation above
    const freshEntities = await getEntities()
    const freshClubs = freshEntities.clubs

    const headlineLower = headline.toLowerCase()
    const { fromClub, toClub, fromClubInferred } = resolveDirection(headlineLower, headline, freshClubs, mentionedClubs)
    if (!fromClub || !toClub || fromClub.id === toClub.id) continue

    results.push({
      playerId: newPlayerId,
      playerName: candidate.name,
      fromClubId: fromClub.id,
      fromClubName: fromClub.name,
      fromClubInferred,
      toClubId: toClub.id,
      toClubName: toClub.name,
      headline,
      confidence: candidate.extractionConfidence,
      autoCreated: true,
    })
  }

  return results
}
