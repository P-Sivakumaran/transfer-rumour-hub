/**
 * Builds the feature vector for one (claim, as-of timestamp) forecast.
 *
 * ── Temporal leakage prevention ──────────────────────────────────────────
 * Every value here must be reconstructible from information that existed
 * at `asOf`, not "now". Two guards enforce this:
 *
 *  1. `claim.firstSeenAt > asOf` → returns null (the claim didn't exist yet;
 *     there is nothing to snapshot).
 *  2. All EvidenceItem rows are filtered to `publishedAt <= asOf` before
 *     ANY feature touches them. This is the one filter that matters most —
 *     see the test suite's "temporal leakage" describe block for the case
 *     that motivated it.
 *
 * A third, less obvious leak this deliberately closes: `Source.reliabilityScore`/
 * `hitCount`/`missCount` are never selected here at all. Those fields are
 * mutated in place by outcomeDetector.ts's applyOutcome() with no history —
 * a snapshot built "as of" a past date would silently read a value already
 * updated by outcomes resolved *after* asOf, and the publishedAt filter
 * above does nothing to catch that (it filters evidence rows, not source
 * state). `Source.tier` stands in as the "source track record" signal
 * instead — it's editorial/manual (manualReviewStatus, profileVersion),
 * not outcome-derived, though not perfectly leakage-free either (a
 * reviewer could still raise/lower tier because of how a track record
 * played out) — see docs/forecasting-methodology.md "Limitations" for why
 * this is flagged rather than fully solved.
 */
import type { ForecastDb, EvidenceItemRow } from './db.js'
import { resolveWindowCutoff, type CutoffConfig } from './windowCutoff.js'
import { createHash } from 'crypto'

export interface FeatureSnapshot {
  asOf: string // ISO
  claimId: number
  features: Record<string, number>
  hash: string
}

const SUPPORT_DIRECTIONS = new Set(['SUPPORTS', 'CONFIRMS'])
const CONTRADICT_DIRECTIONS = new Set(['CONTRADICTS', 'DENIES'])

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

// Tier 1 (best) → 1.0, tier 5 (worst) → 0.2; unknown tier → 0.5 (neutral).
function tierToScore(tier: number | null): number {
  if (tier === null) return 0.5
  return (6 - Math.max(1, Math.min(5, tier))) / 5
}

function canonicalizeFeatures(features: Record<string, number>): Record<string, number> {
  const ordered: Record<string, number> = {}
  for (const key of Object.keys(features).sort()) ordered[key] = features[key]
  return ordered
}

export function hashFeatureSnapshot(claimId: number, asOf: string, features: Record<string, number>): string {
  const payload = JSON.stringify({ claimId, asOf, features: canonicalizeFeatures(features) })
  return createHash('sha256').update(payload).digest('hex')
}

export async function buildFeatureSnapshot(
  db: ForecastDb,
  claimId: number,
  asOf: Date,
  cutoffConfig: CutoffConfig,
): Promise<FeatureSnapshot | null> {
  const claim = await db.claim.findFirst({ where: { id: claimId } })
  if (!claim) return null
  if (claim.firstSeenAt.getTime() > asOf.getTime()) return null // leakage guard 1

  const allEvidence = await db.evidenceItem.findMany({ where: { claimId } })
  const evidenceAsOf: EvidenceItemRow[] = allEvidence.filter((e) => e.publishedAt.getTime() <= asOf.getTime()) // leakage guard 2

  const sourceIds = [...new Set(evidenceAsOf.map((e) => e.sourceId))]
  const sources = sourceIds.length
    ? await db.source.findMany({ where: { id: { in: sourceIds } }, select: { id: true, tier: true } })
    : []
  const tierBySource = new Map(sources.map((s) => [s.id, s.tier]))

  const tierScores = evidenceAsOf.map((e) => tierToScore(tierBySource.get(e.sourceId) ?? null))
  const sourceTierScore = tierScores.length ? average(tierScores) : 0.5
  // Proxy for "historical track record" — see header comment for why the
  // real outcome-derived reliabilityScore/hitCount/missCount are excluded.
  const sourceTrackRecordScore = sourceTierScore

  const independentRootCount = new Set(evidenceAsOf.map((e) => e.provenanceRootId ?? e.id)).size

  const supportCount = evidenceAsOf.filter((e) => SUPPORT_DIRECTIONS.has(e.evidenceDirection)).length
  const contradictCount = evidenceAsOf.filter((e) => CONTRADICT_DIRECTIONS.has(e.evidenceDirection)).length
  const directional = supportCount + contradictCount
  const evidenceDirectionScore = directional > 0 ? supportCount / directional : 0.5

  const mostRecentPublishedAt = evidenceAsOf.reduce<Date | null>(
    (latest, e) => (!latest || e.publishedAt > latest ? e.publishedAt : latest),
    null,
  )
  // Large sentinel (1 year) rather than a special "missing" encoding — kept
  // as a plain number so the sklearn feature vector stays fixed-width; the
  // separate `hasEvidence` flag below is what a model should actually key
  // off of to distinguish "no evidence yet" from "old evidence".
  const mostRecentEvidenceAgeHours = mostRecentPublishedAt
    ? Math.min((asOf.getTime() - mostRecentPublishedAt.getTime()) / 3_600_000, 8760)
    : 8760

  const hasOfficialConfirmation = evidenceAsOf.some(
    (e) => e.sourceType === 'CLUB_OFFICIAL' && e.evidenceDirection === 'CONFIRMS',
  )
    ? 1
    : 0
  const hasOfficialDenial = evidenceAsOf.some(
    (e) => e.sourceType === 'CLUB_OFFICIAL' && e.evidenceDirection === 'DENIES',
  )
    ? 1
    : 0

  const detailFieldsPresent = [
    claim.statedFee != null,
    claim.statedContractLengthMonths != null,
    claim.transferType !== 'UNKNOWN',
  ].filter(Boolean).length
  const detailSpecificityScore = detailFieldsPresent / 3

  // Agreement: each distinct source's most-recent-as-of-asOf direction,
  // then the fraction siding with whichever side (support/contradict) has
  // the majority. 1.0 = unanimous, 0.5 = evenly split, undefined → 0.5.
  const latestDirectionBySource = new Map<number, string>()
  for (const e of [...evidenceAsOf].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) {
    latestDirectionBySource.set(e.sourceId, e.evidenceDirection)
  }
  const perSourceDirections = [...latestDirectionBySource.values()]
  const supportSiding = perSourceDirections.filter((d) => SUPPORT_DIRECTIONS.has(d)).length
  const sourceAgreementScore = perSourceDirections.length
    ? Math.max(supportSiding, perSourceDirections.length - supportSiding) / perSourceDirections.length
    : 0.5

  const player = await db.player.findFirst({ where: { id: claim.playerId }, select: { id: true, contractEnd: true } })
  const monthsToContractExpiry = player?.contractEnd
    ? (player.contractEnd.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : null

  const cutoff = resolveWindowCutoff(claim.window, claim.firstSeenAt, cutoffConfig)
  const windowDaysRemaining = cutoff ? (cutoff.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24) : null

  const entityMatchConfidence = evidenceAsOf.length ? average(evidenceAsOf.map((e) => e.extractionConfidence)) : 0

  const completenessChecks = [
    claim.statedFee != null,
    claim.statedContractLengthMonths != null,
    monthsToContractExpiry != null,
    windowDaysRemaining != null,
    evidenceAsOf.length > 0,
  ]
  const dataCompletenessScore = completenessChecks.filter(Boolean).length / completenessChecks.length

  const features: Record<string, number> = {
    sourceTierScore,
    sourceTrackRecordScore,
    independentRootCount,
    evidenceCount: evidenceAsOf.length,
    evidenceDirectionScore,
    mostRecentEvidenceAgeHours,
    hasEvidence: evidenceAsOf.length > 0 ? 1 : 0,
    hasOfficialConfirmation,
    hasOfficialDenial,
    detailSpecificityScore,
    sourceAgreementScore,
    monthsToContractExpiry: monthsToContractExpiry ?? -1,
    hasContractInfo: monthsToContractExpiry != null ? 1 : 0,
    windowDaysRemaining: windowDaysRemaining ?? -1,
    hasWindowInfo: windowDaysRemaining != null ? 1 : 0,
    entityMatchConfidence,
    dataCompletenessScore,
  }

  const asOfIso = asOf.toISOString()
  return {
    asOf: asOfIso,
    claimId,
    features,
    hash: hashFeatureSnapshot(claimId, asOfIso, features),
  }
}
