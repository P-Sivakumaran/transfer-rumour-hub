import { describe, it, expect } from 'vitest'
import { findOrCreateClaim, listClaims } from './claimsService.js'
import type { EvidenceDb } from './db.js'

function makeFakeTable(seed: Record<string, unknown>[] = []) {
  const rows = [...seed]
  let nextId = Math.max(0, ...rows.map((r) => r.id as number)) + 1
  return {
    rows,
    async findFirst(args: { where: Record<string, unknown> }) {
      return rows.find((r) => Object.entries(args.where).every(([k, v]) => r[k] === v)) ?? null
    },
    async findMany(args: { where?: Record<string, unknown>; skip?: number; take?: number }) {
      const filtered = args?.where
        ? rows.filter((r) => Object.entries(args.where!).every(([k, v]) => r[k] === v))
        : rows
      const skip = args?.skip ?? 0
      const take = args?.take ?? filtered.length
      return filtered.slice(skip, skip + take)
    },
    async create(args: { data: Record<string, unknown> }) {
      const row = { id: nextId++, ...args.data }
      rows.push(row)
      return row
    },
    async update(args: { where: { id: number }; data: Record<string, unknown> }) {
      const row = rows.find((r) => r.id === args.where.id)!
      Object.assign(row, args.data)
      return row
    },
    async count(args: { where?: Record<string, unknown> }) {
      return args?.where
        ? rows.filter((r) => Object.entries(args.where!).every(([k, v]) => r[k] === v)).length
        : rows.length
    },
  }
}

function makeFakeDb(claimSeed: Record<string, unknown>[] = []): EvidenceDb {
  return {
    claim: makeFakeTable(claimSeed),
    evidenceItem: makeFakeTable(),
    evidenceDuplicateCandidate: makeFakeTable(),
    source: makeFakeTable(),
  } as unknown as EvidenceDb
}

describe('findOrCreateClaim', () => {
  it('creates a new claim when no ACTIVE claim matches the tuple', async () => {
    const db = makeFakeDb()
    const claim = await findOrCreateClaim(db, {
      playerId: 1,
      fromClubId: 10,
      toClubId: 20,
      seenAt: new Date('2026-01-01'),
    })
    expect(claim.playerId).toBe(1)
    expect(claim.claimStatus).toBe('ACTIVE')
    expect(claim.firstSeenAt).toEqual(new Date('2026-01-01'))
  })

  it('reuses an existing ACTIVE claim for the same tuple instead of creating a duplicate', async () => {
    const db = makeFakeDb([
      { id: 5, playerId: 1, fromClubId: 10, toClubId: 20, claimStatus: 'ACTIVE', firstSeenAt: new Date('2026-01-01'), lastEvidenceAt: new Date('2026-01-01') },
    ])
    const claim = await findOrCreateClaim(db, { playerId: 1, fromClubId: 10, toClubId: 20, seenAt: new Date('2026-01-02') })
    expect(claim.id).toBe(5)

    const db2 = db as unknown as { claim: { rows: unknown[] } }
    expect(db2.claim.rows).toHaveLength(1)
  })

  it('does NOT reuse a DENIED claim for the same tuple — starts a fresh one instead', async () => {
    const db = makeFakeDb([
      { id: 5, playerId: 1, fromClubId: 10, toClubId: 20, claimStatus: 'DENIED', firstSeenAt: new Date('2026-01-01'), lastEvidenceAt: new Date('2026-01-01') },
    ])
    const claim = await findOrCreateClaim(db, { playerId: 1, fromClubId: 10, toClubId: 20, seenAt: new Date('2026-02-01') })
    expect(claim.id).not.toBe(5)
    expect(claim.claimStatus).toBe('ACTIVE')
  })
})

describe('listClaims', () => {
  it('paginates and filters by playerId', async () => {
    const db = makeFakeDb([
      { id: 1, playerId: 1, claimStatus: 'ACTIVE', lastEvidenceAt: new Date() },
      { id: 2, playerId: 2, claimStatus: 'ACTIVE', lastEvidenceAt: new Date() },
      { id: 3, playerId: 1, claimStatus: 'ACTIVE', lastEvidenceAt: new Date() },
    ])
    const result = await listClaims(db, { playerId: 1 })
    expect(result.total).toBe(2)
    expect(result.data.every((c) => c.playerId === 1)).toBe(true)
  })

  it('builds a source-tier relation filter when sourceTierAtBest is given (advanced filter, Pro entitlement)', async () => {
    let capturedWhere: Record<string, unknown> | undefined
    const db = {
      claim: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          capturedWhere = args.where
          return []
        },
        count: async () => 0,
      },
      evidenceItem: {},
      evidenceDuplicateCandidate: {},
      source: {},
    } as unknown as EvidenceDb

    await listClaims(db, { sourceTierAtBest: 2 })

    expect(capturedWhere).toEqual({ evidence: { some: { source: { tier: { lte: 2 } } } } })
  })

  it('omits the source-tier filter entirely when not given', async () => {
    let capturedWhere: Record<string, unknown> | undefined
    const db = {
      claim: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          capturedWhere = args.where
          return []
        },
        count: async () => 0,
      },
      evidenceItem: {},
      evidenceDuplicateCandidate: {},
      source: {},
    } as unknown as EvidenceDb

    await listClaims(db, {})

    expect(capturedWhere).toEqual({})
  })
})
