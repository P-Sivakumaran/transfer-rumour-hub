/**
 * Wikidata enrichment for auto-created players.
 * Fetches nationality, position, age and verifies the entity is a footballer.
 * Rate-limit friendly: 3 sequential requests per player, background queue only.
 */
import { PrismaClient } from '@prisma/client'

const USER_AGENT = 'TransferRumourHub/1.0 (research project; contact: admin@transfer-hub.dev)'

// Wikidata property IDs
const P_OCCUPATION = 'P106'
const P_NATIONALITY = 'P27'
const P_POSITION = 'P413'
const P_BIRTHDATE = 'P569'

const Q_FOOTBALLER = 'Q937857' // association football player

// Known Wikidata position QIDs → our Position enum
const POSITION_QID_MAP: Record<string, string> = {
  Q200479: 'GK',    // goalkeeper
  Q1369174: 'CB',   // centre-back
  Q225571: 'LB',    // left back
  Q901012: 'RB',    // right back
  Q1085854: 'RB',   // fullback (generic → RB)
  Q193592: 'CDM',   // defensive midfielder
  Q1090034: 'CM',   // midfielder (generic)
  Q1046830: 'CAM',  // attacking midfielder
  Q11681748: 'LW',  // winger (generic → LW)
  Q1074319: 'LW',   // left winger
  Q1627431: 'RW',   // right winger
  Q10297665: 'ST',  // centre-forward
  Q11677751: 'ST',  // striker
  Q944060: 'CF',    // inside forward
}

interface WikidataSearchResult {
  id: string
  label: string
  description: string
}

interface EnrichmentData {
  wikidataId: string
  nationality?: string
  position?: string
  age?: number
}

async function wikidataFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
  return res.json()
}

async function searchWikidata(name: string): Promise<WikidataSearchResult[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=3&format=json`
  const data = (await wikidataFetch(url)) as { search?: WikidataSearchResult[] }
  return data.search ?? []
}

async function getEntityClaims(qid: string): Promise<Record<string, unknown[]>> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&languages=en&format=json`
  const data = (await wikidataFetch(url)) as { entities: Record<string, { claims?: Record<string, unknown[]> }> }
  return data.entities[qid]?.claims ?? {}
}

async function resolveEntityLabel(qid: string): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=en&format=json`
  const data = (await wikidataFetch(url)) as {
    entities: Record<string, { labels?: Record<string, { value: string }> }>
  }
  return data.entities[qid]?.labels?.en?.value ?? null
}

function getClaimStringId(claims: Record<string, unknown[]>, prop: string): string | null {
  const list = claims[prop] as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }> | undefined
  return list?.[0]?.mainsnak?.datavalue?.value?.id ?? null
}

function getClaimTime(claims: Record<string, unknown[]>, prop: string): string | null {
  const list = claims[prop] as Array<{ mainsnak?: { datavalue?: { value?: { time?: string } } } }> | undefined
  return list?.[0]?.mainsnak?.datavalue?.value?.time ?? null
}

function extractYear(wikidataTime: string): number | null {
  const m = wikidataTime.match(/^[+-]?(\d{4})/)
  return m ? parseInt(m[1], 10) : null
}

export async function enrichPlayerFromWikidata(playerName: string): Promise<EnrichmentData | null> {
  try {
    // Step 1: search for matching entity
    const results = await searchWikidata(playerName)
    if (!results.length) return null

    // Prefer exact name match; fallback to first footballer description
    let bestResult: WikidataSearchResult | null = null
    for (const r of results) {
      const desc = (r.description ?? '').toLowerCase()
      if (r.label.toLowerCase() === playerName.toLowerCase() && desc.includes('football')) {
        bestResult = r
        break
      }
    }
    if (!bestResult) {
      // Accept first result if its description mentions football
      const firstWithFootball = results.find((r) => r.description?.toLowerCase().includes('football'))
      if (!firstWithFootball) return null
      bestResult = firstWithFootball
    }

    const qid = bestResult.id

    // Step 2: get entity claims
    const claims = await getEntityClaims(qid)

    // Verify it's a footballer
    const occupations = (
      claims[P_OCCUPATION] as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>
    )
      ?.map((c) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)
    if (!occupations?.includes(Q_FOOTBALLER)) return null

    const enrichment: EnrichmentData = { wikidataId: qid }

    // Birth year → age
    const birthtime = getClaimTime(claims, P_BIRTHDATE)
    if (birthtime) {
      const birthYear = extractYear(birthtime)
      if (birthYear) enrichment.age = new Date().getFullYear() - birthYear
    }

    // Position
    const positionQid = getClaimStringId(claims, P_POSITION)
    if (positionQid && POSITION_QID_MAP[positionQid]) {
      enrichment.position = POSITION_QID_MAP[positionQid]
    }

    // Nationality (resolve label in parallel with position if needed)
    const nationalityQid = getClaimStringId(claims, P_NATIONALITY)
    if (nationalityQid) {
      const label = await resolveEntityLabel(nationalityQid)
      if (label) enrichment.nationality = label
    }

    return enrichment
  } catch (err) {
    console.warn(`[enrichment] Wikidata lookup failed for "${playerName}":`, (err as Error).message)
    return null
  }
}

export async function runPlayerEnrichment(playerId: number, playerName: string, db: PrismaClient): Promise<void> {
  const data = await enrichPlayerFromWikidata(playerName)
  if (!data) {
    console.log(`[enrichment] No Wikidata match for "${playerName}"`)
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { wikidataId: data.wikidataId, enrichedAt: new Date() }
  if (data.nationality) update.nationality = data.nationality
  if (data.age) update.age = data.age
  if (data.position) update.position = data.position

  await db.player.update({ where: { id: playerId }, data: update })
  console.log(`[enrichment] Enriched player "${playerName}" (id=${playerId}):`, JSON.stringify(data))
}
