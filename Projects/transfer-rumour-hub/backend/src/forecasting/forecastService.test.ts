import { describe, it, expect } from 'vitest'
import { getClaimForecast } from './forecastService.js'
import type { ForecastDb } from './db.js'
import type { MlForecastClient, ScoreResponse } from './mlForecastClient.js'

const CLAIM = {
  id: 1, playerId: 1, transferType: 'PERMANENT', statedFee: null,
  statedContractLengthMonths: null, window: null, firstSeenAt: new Date('2026-01-01'),
}
const DEFINITION = {
  id: 10, version: 1, horizonDays: 30, isActive: true,
  summerCutoffMonthDay: '08-31', winterCutoffMonthDay: '01-31',
}

function makeDb(overrides: {
  claim?: typeof CLAIM | null
  modelVersion?: Record<string, unknown> | null
  createCalls?: Record<string, unknown>[]
}): ForecastDb {
  const createCalls = overrides.createCalls ?? []
  return {
    claim: { async findFirst() { return overrides.claim === undefined ? CLAIM : overrides.claim } },
    evidenceItem: { async findMany() { return [] } },
    source: { async findMany() { return [] } },
    player: { async findFirst() { return null } },
    forecastDefinition: { async findFirst() { return DEFINITION } },
    modelVersion: { async findFirst() { return overrides.modelVersion === undefined ? null : overrides.modelVersion } },
    claimForecast: {
      async create(args: { data: Record<string, unknown> }) {
        createCalls.push(args.data)
        return args.data
      },
    },
  } as unknown as ForecastDb
}

function makeMlClient(impl: () => Promise<ScoreResponse>): MlForecastClient {
  return { score: impl }
}

describe('getClaimForecast — acceptance gates', () => {
  it('returns null when the claim does not exist', async () => {
    const db = makeDb({ claim: null })
    const result = await getClaimForecast(db, makeMlClient(async () => { throw new Error('should not be called') }), 999)
    expect(result).toBeNull()
  })

  it('INSUFFICIENT_DATA when no current model version exists', async () => {
    const calls: Record<string, unknown>[] = []
    const db = makeDb({ modelVersion: null, createCalls: calls })
    const result = await getClaimForecast(db, makeMlClient(async () => { throw new Error('should not be called') }), 1)
    expect(result?.displayMode).toBe('INSUFFICIENT_DATA')
    expect(result?.insufficientDataReason).toMatch(/no trained model/i)
    expect(result?.calibratedProbability).toBeUndefined()
    expect(calls[0].displayMode).toBe('INSUFFICIENT_DATA')
  })

  it('INSUFFICIENT_DATA — a model trained on synthetic data NEVER displays a probability, regardless of sample size', async () => {
    // The critical product rule: displayed probability must be calibrated
    // against RESOLVED HISTORICAL OUTCOMES. Synthetic nTestSamples is a
    // fabricated number (arbitrarily generatable) — this gate must block
    // display even when it's huge.
    const db = makeDb({
      modelVersion: { id: 5, trainingDataSource: 'synthetic', nTestSamples: 100_000, minSampleSizeForPrecise: 200 },
    })
    const result = await getClaimForecast(db, makeMlClient(async () => { throw new Error('should not be called') }), 1)
    expect(result?.displayMode).toBe('INSUFFICIENT_DATA')
    expect(result?.insufficientDataReason).toMatch(/synthetic/i)
    expect(result?.calibratedProbability).toBeUndefined()
  })

  it('INSUFFICIENT_DATA when the model was evaluated on too few held-out samples', async () => {
    const db = makeDb({
      modelVersion: { id: 5, trainingDataSource: 'db', nTestSamples: 40, minSampleSizeForPrecise: 200 },
    })
    const result = await getClaimForecast(db, makeMlClient(async () => { throw new Error('should not be called') }), 1)
    expect(result?.displayMode).toBe('INSUFFICIENT_DATA')
    expect(result?.insufficientDataReason).toMatch(/40 held-out samples/)
  })

  it('INSUFFICIENT_DATA when the ml-service call fails — never falls back to a heuristic number', async () => {
    const db = makeDb({ modelVersion: { id: 5, trainingDataSource: 'db', nTestSamples: 500, minSampleSizeForPrecise: 200 } })
    const result = await getClaimForecast(db, makeMlClient(async () => { throw new Error('service down') }), 1)
    expect(result?.displayMode).toBe('INSUFFICIENT_DATA')
    expect(result?.insufficientDataReason).toMatch(/unavailable/i)
    expect(result?.calibratedProbability).toBeUndefined()
  })

  it('PRECISE when the model is db-trained, sufficiently sampled, and the uncertainty band is narrow', async () => {
    const calls: Record<string, unknown>[] = []
    const db = makeDb({
      modelVersion: { id: 5, trainingDataSource: 'db', nTestSamples: 500, minSampleSizeForPrecise: 200 },
      createCalls: calls,
    })
    const result = await getClaimForecast(
      db,
      makeMlClient(async () => ({
        rawScore: 0.7, calibratedProbability: 0.62, uncertaintyLow: 0.55, uncertaintyHigh: 0.68, modelVersion: 'v1',
      })),
      1,
    )
    expect(result?.displayMode).toBe('PRECISE')
    expect(result?.calibratedProbability).toBe(0.62)
    expect(calls[0].displayMode).toBe('PRECISE')
    expect(calls[0].calibratedProbability).toBe(0.62)
  })

  it('INTERVAL (not PRECISE) when the uncertainty band is too wide for a point estimate', async () => {
    const db = makeDb({ modelVersion: { id: 5, trainingDataSource: 'db', nTestSamples: 500, minSampleSizeForPrecise: 200 } })
    const result = await getClaimForecast(
      db,
      makeMlClient(async () => ({
        rawScore: 0.5, calibratedProbability: 0.5, uncertaintyLow: 0.2, uncertaintyHigh: 0.8, modelVersion: 'v1',
      })),
      1,
    )
    expect(result?.displayMode).toBe('INTERVAL')
    expect(result?.uncertaintyLow).toBe(0.2)
    expect(result?.uncertaintyHigh).toBe(0.8)
  })

  it('every path persists a ClaimForecast row, including INSUFFICIENT_DATA ones', async () => {
    const calls: Record<string, unknown>[] = []
    const db = makeDb({ modelVersion: null, createCalls: calls })
    await getClaimForecast(db, makeMlClient(async () => { throw new Error('n/a') }), 1)
    expect(calls).toHaveLength(1)
    expect(calls[0].claimId).toBe(1)
    expect(calls[0].featureSnapshotHash).toBeTypeOf('string')
  })
})
