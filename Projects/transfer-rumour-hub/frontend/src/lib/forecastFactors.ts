/**
 * Derives human-readable "why this forecast" factors from the evidence
 * model (ClaimDetail — evidenceCount, independentSourceCount, provenance
 * clusters, official confirmation/denial), NOT from raw ML feature weights.
 *
 * Deliberate: the backend's forecast endpoint returns a calibrated
 * probability but not a per-feature attribution (no SHAP/coefficient
 * breakdown is persisted — see docs/forecasting-methodology.md). Rather
 * than inventing a fake attribution endpoint, this derives factors from
 * data that's already interpretable by construction: the evidence model
 * itself. This also naturally satisfies "explain independent corroboration,
 * not raw article count" — the distinction IS the data model's own
 * independentSourceCount vs. evidenceCount split.
 */
import type { ClaimDetail, ForecastFactor } from '@/types'

const STALE_EVIDENCE_DAYS = 14

export interface WhatWouldChange {
  text: string
  kind: 'confirmation' | 'denial' | 'corroboration' | 'time'
}

export function deriveForecastFactors(claim: ClaimDetail, now: Date = new Date()): ForecastFactor[] {
  const factors: ForecastFactor[] = []

  if (claim.officialConfirmation) {
    factors.push({
      label: 'Official club confirmation',
      direction: 'positive',
      magnitude: 1.0,
      explanation: `${claim.officialConfirmation.sourceName ?? 'The club'} has officially confirmed this.`,
      evidenceItemId: claim.officialConfirmation.id,
    })
  }

  if (claim.officialDenial) {
    factors.push({
      label: 'Official club denial',
      direction: 'negative',
      magnitude: 1.0,
      explanation: `${claim.officialDenial.sourceName ?? 'The club'} has officially denied this.`,
      evidenceItemId: claim.officialDenial.id,
    })
  }

  if (claim.independentSourceCount >= 2) {
    const strongestCluster = [...claim.provenanceClusters].sort(
      (a, b) => b.syndicated.length - a.syndicated.length,
    )[0]
    factors.push({
      label: `${claim.independentSourceCount} independent sources`,
      direction: 'positive',
      magnitude: Math.min(claim.independentSourceCount / 5, 1) * 0.75,
      explanation: `${claim.independentSourceCount} separately-originating reports corroborate this — counting distinct original stories, not syndicated copies of the same one.`,
      evidenceItemId: strongestCluster?.root.id,
    })
  } else if (claim.independentSourceCount === 1 && claim.evidenceCount > 1) {
    const cluster = claim.provenanceClusters[0]
    factors.push({
      label: 'Single original source',
      direction: 'negative',
      magnitude: 0.4,
      explanation: `All ${claim.evidenceCount} articles trace back to one original report — republished and syndicated, not independently corroborated.`,
      evidenceItemId: cluster?.root.id,
    })
  } else if (claim.independentSourceCount === 0) {
    factors.push({
      label: 'No corroborating evidence',
      direction: 'negative',
      magnitude: 0.5,
      explanation: 'No evidence has been captured for this claim yet.',
    })
  }

  const contradicting = claim.provenanceClusters
    .flatMap((c) => [c.root, ...c.syndicated])
    .find((e) => e.evidenceDirection === 'CONTRADICTS')
  if (contradicting) {
    factors.push({
      label: 'Conflicting report',
      direction: 'negative',
      magnitude: 0.5,
      explanation: `${contradicting.sourceName ?? 'A source'} published a report that contradicts this claim.`,
      evidenceItemId: contradicting.id,
    })
  }

  if (!claim.officialConfirmation && !claim.officialDenial) {
    const daysSinceLastEvidence = (now.getTime() - new Date(claim.lastEvidenceAt).getTime()) / 86_400_000
    if (daysSinceLastEvidence > STALE_EVIDENCE_DAYS) {
      factors.push({
        label: 'Evidence has gone quiet',
        direction: 'negative',
        magnitude: Math.min(daysSinceLastEvidence / 60, 1) * 0.5,
        explanation: `No new evidence in ${Math.round(daysSinceLastEvidence)} days.`,
      })
    }
  }

  if (claim.statedFee != null) {
    factors.push({
      label: 'Specific fee reported',
      direction: 'positive',
      magnitude: 0.25,
      explanation: `A specific fee (€${claim.statedFee}M) has been reported, suggesting detailed sourcing rather than speculation.`,
    })
  }

  return factors
}

export function topFactors(factors: ForecastFactor[], direction: 'positive' | 'negative', n = 3): ForecastFactor[] {
  return factors
    .filter((f) => f.direction === direction)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, n)
}

/** Requirement: "What would change this?" — official confirmation, denial,
 * a credible independent report, or elapsed time. Only includes bullets
 * that are actually still open (e.g. no "an official confirmation would
 * change this" once one already exists). */
export function whatWouldChangeThis(claim: ClaimDetail): WhatWouldChange[] {
  const items: WhatWouldChange[] = []

  if (!claim.officialConfirmation) {
    items.push({ kind: 'confirmation', text: 'An official club confirmation would sharply increase this forecast.' })
  }
  if (!claim.officialDenial) {
    items.push({ kind: 'denial', text: 'An official denial would end this claim and drop the forecast to near zero.' })
  }
  if (claim.independentSourceCount < 2) {
    items.push({
      kind: 'corroboration',
      text: 'A credible, independently-sourced report (not a syndication of the existing one) would strengthen this.',
    })
  }
  if (claim.window) {
    items.push({
      kind: 'time',
      text: 'If the transfer window closes with no confirmation, this claim will expire unresolved.',
    })
  }

  return items
}
