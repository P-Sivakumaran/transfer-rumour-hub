import { describe, it, expect } from 'vitest'
import { computeScore } from './likelihoodEngine.js'

const BASE_INPUTS = {
  sourceReliability: 0.8,
  monthsToContractExpiry: 12,
  reportedFeeMin: 80,
  reportedFeeMax: 100,
  marketValue: 90,
  clubNeedScore: 0.7,
  distinctSourceCount: 3,
  baseProbability: 0.6,
}

describe('computeScore', () => {
  it('returns score in 0–100 range', () => {
    const { score } = computeScore(BASE_INPUTS)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('higher source reliability → higher score', () => {
    const low = computeScore({ ...BASE_INPUTS, sourceReliability: 0.1 })
    const high = computeScore({ ...BASE_INPUTS, sourceReliability: 0.95 })
    expect(high.score).toBeGreaterThan(low.score)
  })

  it('imminent contract expiry increases score', () => {
    const longContract = computeScore({ ...BASE_INPUTS, monthsToContractExpiry: 36 })
    const shortContract = computeScore({ ...BASE_INPUTS, monthsToContractExpiry: 2 })
    expect(shortContract.score).toBeGreaterThan(longContract.score)
  })

  it('more distinct sources increases score', () => {
    const one = computeScore({ ...BASE_INPUTS, distinctSourceCount: 1 })
    const five = computeScore({ ...BASE_INPUTS, distinctSourceCount: 5 })
    expect(five.score).toBeGreaterThan(one.score)
  })

  it('breakdown components sum ≤ 100', () => {
    const { breakdown } = computeScore(BASE_INPUTS)
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0)
    expect(sum).toBeLessThanOrEqual(100)
  })

  it('handles null contract expiry gracefully', () => {
    const { score } = computeScore({ ...BASE_INPUTS, monthsToContractExpiry: null })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('unreliable social media source → low score', () => {
    const { score } = computeScore({
      sourceReliability: 0.1,
      monthsToContractExpiry: 30,
      reportedFeeMin: null,
      reportedFeeMax: null,
      marketValue: null,
      clubNeedScore: 0.1,
      distinctSourceCount: 1,
      baseProbability: 0.2,
    })
    expect(score).toBeLessThan(30)
  })
})
