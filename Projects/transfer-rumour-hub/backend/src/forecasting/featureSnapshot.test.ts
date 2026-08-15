import { describe, it, expect } from 'vitest'
import { buildFeatureSnapshot, hashFeatureSnapshot } from './featureSnapshot.js'
import type { ForecastDb } from './db.js'

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in (v as object)) return (v as { in: unknown[] }).in.includes(row[k])
      if ('not' in (v as object)) return row[k] !== (v as { not: unknown }).not
    }
    return row[k] === v
  })
}

const CUTOFF_CONFIG = { summerCutoffMonthDay: '08-31', winterCutoffMonthDay: '01-31' }

function makeDb(opts: {
  claim: Record<string, unknown>
  evidence?: Record<string, unknown>[]
  sources?: Record<string, unknown>[]
  player?: Record<string, unknown> | null
}): ForecastDb {
  const evidence = opts.evidence ?? []
  const sources = opts.sources ?? []
  return {
    claim: { async findFirst(args: any) { return matchesWhere(opts.claim, args.where) ? opts.claim as any : null } },
    evidenceItem: { async findMany(args: any) { return evidence.filter((e) => matchesWhere(e, args.where)) as any } },
    source: { async findMany(args: any) { return sources.filter((s) => matchesWhere(s, args.where)) as any } },
    player: { async findFirst(args: any) { return opts.player && matchesWhere(opts.player, args.where) ? opts.player as any : null } },
    forecastDefinition: { async findFirst() { return null } },
    modelVersion: { async findFirst() { return null } },
    claimForecast: { async create() { return null } },
  } as unknown as ForecastDb
}

const BASE_CLAIM = {
  id: 1,
  playerId: 1,
  transferType: 'PERMANENT',
  statedFee: null,
  statedContractLengthMonths: null,
  window: null,
  firstSeenAt: new Date('2026-01-01T00:00:00Z'),
}

describe('buildFeatureSnapshot — existence guard', () => {
  it('returns null when the claim does not exist', async () => {
    const db = makeDb({ claim: { ...BASE_CLAIM, id: 999 } })
    const snapshot = await buildFeatureSnapshot(db, 1, new Date('2026-01-02'), CUTOFF_CONFIG)
    expect(snapshot).toBeNull()
  })

  it('returns null when asOf is before the claim existed (firstSeenAt)', async () => {
    const db = makeDb({ claim: BASE_CLAIM })
    const snapshot = await buildFeatureSnapshot(db, 1, new Date('2025-12-31T00:00:00Z'), CUTOFF_CONFIG)
    expect(snapshot).toBeNull()
  })
})

describe('buildFeatureSnapshot — temporal leakage prevention', () => {
  it('excludes evidence published after asOf from every derived feature', async () => {
    const pastEvidence = {
      id: 1, claimId: 1, sourceId: 1, publishedAt: new Date('2026-01-05T00:00:00Z'),
      sourceType: 'NEWS_OUTLET', evidenceDirection: 'SUPPORTS', provenanceRootId: 1, extractionConfidence: 0.6,
    }
    // This official confirmation happens AFTER asOf — a leaking implementation
    // would let hasOfficialConfirmation/evidenceDirectionScore see it.
    const futureConfirmation = {
      id: 2, claimId: 1, sourceId: 2, publishedAt: new Date('2026-02-01T00:00:00Z'),
      sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'CONFIRMS', provenanceRootId: 2, extractionConfidence: 1.0,
    }
    const db = makeDb({
      claim: BASE_CLAIM,
      evidence: [pastEvidence, futureConfirmation],
      sources: [{ id: 1, tier: 2 }, { id: 2, tier: 1 }],
    })

    const asOf = new Date('2026-01-10T00:00:00Z') // strictly between the two evidence items
    const snapshot = await buildFeatureSnapshot(db, 1, asOf, CUTOFF_CONFIG)

    expect(snapshot).not.toBeNull()
    expect(snapshot!.features.evidenceCount).toBe(1) // not 2
    expect(snapshot!.features.hasOfficialConfirmation).toBe(0) // not 1 — the leak this test exists to catch
    expect(snapshot!.features.independentRootCount).toBe(1) // not 2
  })

  it('is unaffected by Source fields other than tier — reliabilityScore/hitCount/missCount are never read', async () => {
    const evidence = [
      { id: 1, claimId: 1, sourceId: 1, publishedAt: new Date('2026-01-05T00:00:00Z'), sourceType: 'NEWS_OUTLET', evidenceDirection: 'SUPPORTS', provenanceRootId: 1, extractionConfidence: 0.6 },
    ]
    const asOf = new Date('2026-01-10T00:00:00Z')

    const dbBefore = makeDb({
      claim: BASE_CLAIM,
      evidence,
      sources: [{ id: 1, tier: 3, reliabilityScore: 0.9, hitCount: 50, missCount: 1 }],
    })
    const snapshotBefore = await buildFeatureSnapshot(dbBefore, 1, asOf, CUTOFF_CONFIG)

    // Simulate the source's reliability having since been mutated by
    // outcomeDetector.ts's applyOutcome() (as would happen after asOf, from
    // outcomes resolved on OTHER claims) — tier is unchanged.
    const dbAfter = makeDb({
      claim: BASE_CLAIM,
      evidence,
      sources: [{ id: 1, tier: 3, reliabilityScore: 0.12, hitCount: 51, missCount: 40 }],
    })
    const snapshotAfter = await buildFeatureSnapshot(dbAfter, 1, asOf, CUTOFF_CONFIG)

    expect(snapshotAfter!.features).toEqual(snapshotBefore!.features)
  })

  it('is deterministic and hash-stable for the same (claimId, asOf, features)', async () => {
    const evidence = [
      { id: 1, claimId: 1, sourceId: 1, publishedAt: new Date('2026-01-05T00:00:00Z'), sourceType: 'NEWS_OUTLET', evidenceDirection: 'SUPPORTS', provenanceRootId: 1, extractionConfidence: 0.6 },
    ]
    const db = makeDb({ claim: BASE_CLAIM, evidence, sources: [{ id: 1, tier: 3 }] })
    const asOf = new Date('2026-01-10T00:00:00Z')

    const first = await buildFeatureSnapshot(db, 1, asOf, CUTOFF_CONFIG)
    const second = await buildFeatureSnapshot(db, 1, asOf, CUTOFF_CONFIG)
    expect(first!.hash).toBe(second!.hash)
    expect(first!.hash).toBe(hashFeatureSnapshot(1, asOf.toISOString(), first!.features))
  })
})

describe('buildFeatureSnapshot — feature correctness', () => {
  it('an official confirmation and denial are both reflected independently', async () => {
    const evidence = [
      { id: 1, claimId: 1, sourceId: 1, publishedAt: new Date('2026-01-02'), sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'CONFIRMS', provenanceRootId: 1, extractionConfidence: 1 },
    ]
    const db = makeDb({ claim: BASE_CLAIM, evidence, sources: [{ id: 1, tier: 1 }] })
    const snapshot = await buildFeatureSnapshot(db, 1, new Date('2026-01-05'), CUTOFF_CONFIG)
    expect(snapshot!.features.hasOfficialConfirmation).toBe(1)
    expect(snapshot!.features.hasOfficialDenial).toBe(0)
  })

  it('computes windowDaysRemaining from a configured cutoff when the claim has a window', async () => {
    const db = makeDb({ claim: { ...BASE_CLAIM, window: 'SUMMER' } })
    const snapshot = await buildFeatureSnapshot(db, 1, new Date('2026-08-01'), CUTOFF_CONFIG)
    expect(snapshot!.features.hasWindowInfo).toBe(1)
    expect(snapshot!.features.windowDaysRemaining).toBeCloseTo(31, 0)
  })

  it('sentinel-encodes missing window/contract info rather than crashing', async () => {
    const db = makeDb({ claim: BASE_CLAIM }) // no window, no player row
    const snapshot = await buildFeatureSnapshot(db, 1, new Date('2026-01-05'), CUTOFF_CONFIG)
    expect(snapshot!.features.hasWindowInfo).toBe(0)
    expect(snapshot!.features.windowDaysRemaining).toBe(-1)
    expect(snapshot!.features.hasContractInfo).toBe(0)
    expect(snapshot!.features.monthsToContractExpiry).toBe(-1)
  })
})
