/**
 * Pure functions behind provenance-root assignment. No DB access — kept
 * separate from evidenceService.ts so the matching/scoring logic itself can
 * be unit-tested without a database, same split as
 * entityMatcher.ts (fuzzy matching) vs. the workers.ts callers that persist
 * its output.
 */

// ─── Text similarity (near-duplicate candidates) ───────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// Jaccard similarity over token sets — deliberately simpler than
// entityMatcher.ts's Levenshtein-based `similarity()` (which is tuned for
// short entity names, not full headlines/body text). Word-set overlap is
// the right granularity for "did two articles cover the same story",
// where word order and minor rewrites shouldn't tank the score the way
// character-edit-distance would over a 100+ character string.
export function textSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const tok of setA) if (setB.has(tok)) intersection++
  const union = setA.size + setB.size - intersection
  return intersection / union
}

// Below this, two articles aren't worth logging as duplicate candidates at
// all (requirement 4b) — most pairs of unrelated transfer headlines share
// some token overlap ("transfer", player surnames also mentioned elsewhere).
export const DUPLICATE_CANDIDATE_THRESHOLD = 0.55

// ─── Explicit attribution detection ────────────────────────────────────────

// "according to X", "as (first) reported by X", "per X", "citing X" — the
// same journalism-attribution phrasing outcomeDetector.ts and entityMatcher.ts
// already key off of for other purposes (e.g. FROM_ATTRIBUTION_PRECEDING in
// entityMatcher.ts, which exists to *reject* a false "from" cue caused by
// this exact phrasing). Captures up to 4 capitalized words as the cited name.
const ATTRIBUTION_PATTERN =
  /\b(?:according to|as (?:first )?reported by|as per|per|citing|via)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/

export interface AttributionMatch {
  citedName: string
}

export function detectAttributionPhrase(text: string): AttributionMatch | null {
  const m = text.match(ATTRIBUTION_PATTERN)
  if (!m || !m[1]) return null
  return { citedName: m[1].trim() }
}

// Matches a cited name (free text, from detectAttributionPhrase) against a
// list of known source names, tolerating case and light punctuation
// differences ("Fabrizio Romano" vs "fabrizio romano") but not fuzzy typo
// correction — an attribution link is a citation graph edge asserted by the
// article's own text, not a guess, so it should only fire on a real match.
function normaliseSourceName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function matchAttributedSource(
  citedName: string,
  knownSources: Array<{ id: number; name: string }>,
): { id: number; name: string } | null {
  const normalisedCited = normaliseSourceName(citedName)

  for (const source of knownSources) {
    if (normalisedCited === normaliseSourceName(source.name)) return source
  }

  // Whole-word-subset containment ("Fabrizio Romano" cited inside "according
  // to Fabrizio Romano, Sky Sports" style compound attributions) — but only
  // once both sides have 2+ words. A single short word ("Sky") is too
  // ambiguous to safely resolve to one specific outlet when several known
  // sources could share it (e.g. "Sky Sports" vs. "Sky Sports News") — the
  // subset check alone can't tell which one was actually meant.
  const citedWords = normalisedCited.split(' ')
  if (citedWords.length < 2) return null

  for (const source of knownSources) {
    const nameWords = normaliseSourceName(source.name).split(' ')
    if (nameWords.length < 2) continue
    if (citedWords.every((w) => nameWords.includes(w)) || nameWords.every((w) => citedWords.includes(w))) {
      return source
    }
  }
  return null
}
