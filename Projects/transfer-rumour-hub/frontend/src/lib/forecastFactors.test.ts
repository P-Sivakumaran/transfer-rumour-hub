import { describe, it, expect } from 'vitest'
import { deriveForecastFactors, topFactors, whatWouldChangeThis } from './forecastFactors'
import { gyokeresClaimDetail, davidClaimDetail } from '@/test/fixtures'

describe('deriveForecastFactors', () => {
  it('includes an official-confirmation positive factor when present', () => {
    const factors = deriveForecastFactors(gyokeresClaimDetail)
    const confirmation = factors.find((f) => f.label === 'Official club confirmation')
    expect(confirmation?.direction).toBe('positive')
    expect(confirmation?.magnitude).toBe(1.0)
    expect(confirmation?.evidenceItemId).toBe(6)
  })

  it('includes an official-denial negative factor when present, not a confirmation factor', () => {
    const factors = deriveForecastFactors(davidClaimDetail)
    expect(factors.find((f) => f.label === 'Official club denial')?.direction).toBe('negative')
    expect(factors.find((f) => f.label === 'Official club confirmation')).toBeUndefined()
  })

  it('explains independent corroboration by count of independent roots, not raw article count', () => {
    // gyokeresClaimDetail: evidenceCount=6, independentSourceCount=2
    const factors = deriveForecastFactors(gyokeresClaimDetail)
    const corroboration = factors.find((f) => f.label.includes('independent sources'))
    expect(corroboration?.label).toContain('2 independent sources') // not "6"
    expect(corroboration?.explanation).not.toMatch(/6 articles/)
  })

  it('flags a single-original-source claim as a negative factor, not a positive one', () => {
    const singleSourceClaim = {
      ...gyokeresClaimDetail,
      evidenceCount: 5,
      independentSourceCount: 1,
      provenanceClusters: [gyokeresClaimDetail.provenanceClusters[0]],
      officialConfirmation: null,
    }
    const factors = deriveForecastFactors(singleSourceClaim)
    const factor = factors.find((f) => f.label === 'Single original source')
    expect(factor?.direction).toBe('negative')
    expect(factor?.explanation).toMatch(/5 articles/)
  })

  it('flags stale evidence only when there is no official confirmation/denial', () => {
    const now = new Date('2026-09-01T00:00:00Z') // ~3 weeks after gyokeres claim's lastEvidenceAt, but it HAS a confirmation
    const factorsWithConfirmation = deriveForecastFactors(gyokeresClaimDetail, now)
    expect(factorsWithConfirmation.find((f) => f.label === 'Evidence has gone quiet')).toBeUndefined()

    const unresolvedClaim = { ...gyokeresClaimDetail, officialConfirmation: null }
    const factorsUnresolved = deriveForecastFactors(unresolvedClaim, now)
    expect(factorsUnresolved.find((f) => f.label === 'Evidence has gone quiet')).toBeDefined()
  })
})

describe('topFactors', () => {
  it('sorts by magnitude descending and respects the limit', () => {
    const factors = deriveForecastFactors(gyokeresClaimDetail)
    const positives = topFactors(factors, 'positive', 1)
    expect(positives).toHaveLength(1)
    expect(positives[0].magnitude).toBe(Math.max(...factors.filter((f) => f.direction === 'positive').map((f) => f.magnitude)))
  })
})

describe('whatWouldChangeThis', () => {
  it('omits the confirmation bullet once a claim is already confirmed', () => {
    const changes = whatWouldChangeThis(gyokeresClaimDetail)
    expect(changes.find((c) => c.kind === 'confirmation')).toBeUndefined()
    expect(changes.find((c) => c.kind === 'denial')).toBeDefined()
  })

  it('omits the denial bullet once a claim is already denied', () => {
    const changes = whatWouldChangeThis(davidClaimDetail)
    expect(changes.find((c) => c.kind === 'denial')).toBeUndefined()
  })

  it('includes the time/window bullet only when the claim has a window', () => {
    const withWindow = whatWouldChangeThis(gyokeresClaimDetail)
    expect(withWindow.find((c) => c.kind === 'time')).toBeDefined()

    const noWindow = whatWouldChangeThis({ ...gyokeresClaimDetail, window: null })
    expect(noWindow.find((c) => c.kind === 'time')).toBeUndefined()
  })
})
