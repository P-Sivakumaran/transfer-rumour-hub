import { describe, it, expect } from 'vitest'
import { resolveLabel } from './labels.js'
import type { EvidenceItemRow } from './db.js'

const CUTOFF_CONFIG = { summerCutoffMonthDay: '08-31', winterCutoffMonthDay: '01-31' }

function evidenceRow(overrides: Partial<EvidenceItemRow>): EvidenceItemRow {
  return {
    id: 1, claimId: 1, sourceId: 1, publishedAt: new Date(), sourceType: 'NEWS_OUTLET',
    evidenceDirection: 'SUPPORTS', provenanceRootId: 1, extractionConfidence: 0.5, ...overrides,
  }
}

describe('resolveLabel', () => {
  const claim = { window: null, firstSeenAt: new Date('2026-01-01') }

  it('labels 1 when an official confirmation lands within the horizon', () => {
    const asOf = new Date('2026-01-01T00:00:00Z')
    const confirmation = evidenceRow({
      sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'CONFIRMS',
      publishedAt: new Date('2026-01-05T00:00:00Z'),
    })
    const result = resolveLabel(claim, [confirmation], 30, CUTOFF_CONFIG, asOf, new Date('2026-06-01'))
    expect(result.label).toBe(1)
  })

  it('ignores a confirmation that happened before asOf (not a future event relative to the prediction)', () => {
    const asOf = new Date('2026-01-10T00:00:00Z')
    const confirmation = evidenceRow({
      sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'CONFIRMS',
      publishedAt: new Date('2026-01-05T00:00:00Z'), // before asOf
    })
    const result = resolveLabel(claim, [confirmation], 30, CUTOFF_CONFIG, asOf, new Date('2026-06-01'))
    // No confirmation strictly after asOf and within horizon, and the
    // horizon has passed by `now` → label 0, not 1.
    expect(result.label).toBe(0)
  })

  it('ignores a confirmation that lands after the horizon/deadline', () => {
    const asOf = new Date('2026-01-01T00:00:00Z')
    const lateConfirmation = evidenceRow({
      sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'CONFIRMS',
      publishedAt: new Date('2026-03-01T00:00:00Z'), // well past a 30-day horizon
    })
    const result = resolveLabel(claim, [lateConfirmation], 30, CUTOFF_CONFIG, asOf, new Date('2026-06-01'))
    expect(result.label).toBe(0)
    expect(result.reason).toBe('DEADLINE_PASSED')
  })

  it('returns null (STILL_PENDING) when the deadline has not arrived yet and no confirmation exists', () => {
    const asOf = new Date('2026-01-01T00:00:00Z')
    const result = resolveLabel(claim, [], 30, CUTOFF_CONFIG, asOf, new Date('2026-01-10')) // now is only 9 days later
    expect(result.label).toBeNull()
    expect(result.reason).toBe('STILL_PENDING')
  })

  it('respects the window cutoff when it is earlier than the horizon', () => {
    const summerClaim = { window: 'SUMMER', firstSeenAt: new Date('2026-08-25') }
    const asOf = new Date('2026-08-25T00:00:00Z')
    // Horizon is 60 days out (Oct 24), but the SUMMER cutoff (Aug 31) is
    // sooner — a confirmation on Sep 15 is after the real deadline.
    const lateConfirmation = evidenceRow({
      sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'CONFIRMS',
      publishedAt: new Date('2026-09-15T00:00:00Z'),
    })
    const result = resolveLabel(summerClaim, [lateConfirmation], 60, CUTOFF_CONFIG, asOf, new Date('2026-10-01'))
    expect(result.label).toBe(0)
  })

  it('a denial does not by itself produce label 1 (only CLUB_OFFICIAL + CONFIRMS does)', () => {
    const asOf = new Date('2026-01-01T00:00:00Z')
    const denial = evidenceRow({
      sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'DENIES',
      publishedAt: new Date('2026-01-05T00:00:00Z'),
    })
    const result = resolveLabel(claim, [denial], 30, CUTOFF_CONFIG, asOf, new Date('2026-06-01'))
    expect(result.label).toBe(0)
  })
})
