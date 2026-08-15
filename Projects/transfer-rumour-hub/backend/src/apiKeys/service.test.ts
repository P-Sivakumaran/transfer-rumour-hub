import { describe, it, expect } from 'vitest'
import { createApiKey, listApiKeys, revokeApiKey, authenticateApiKey } from './service.js'
import { hashSecret } from './hashing.js'
import type { ApiKeyDb, ApiKeyRow, ApiKeyScope } from './db.js'

function makeFakeDb(rows: ApiKeyRow[] = [], tiers: Record<number, 'FREE' | 'PRO' | 'RESEARCH'> = {}): ApiKeyDb {
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1
  return {
    apiKey: {
      create: async ({ data }) => {
        const row: ApiKeyRow = {
          id: nextId++,
          userId: data.userId,
          keyPrefix: data.keyPrefix,
          secretHash: data.secretHash,
          name: data.name,
          scopes: data.scopes,
          createdAt: new Date(),
          lastUsedAt: null,
          expiresAt: data.expiresAt,
          revokedAt: null,
        }
        rows.push(row)
        return row
      },
      findUnique: async ({ where }) => rows.find((r) => r.keyPrefix === where.keyPrefix) ?? null,
      findFirst: async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }) => rows.filter((r) => r.userId === where.userId),
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id)!
        Object.assign(row, data)
        return row
      },
    },
    user: {
      findUnique: async ({ where }) => {
        const tier = tiers[where.id]
        return tier ? { tier } : null
      },
    },
  }
}

describe('createApiKey / listApiKeys', () => {
  it('returns the plaintext key once at creation, and only masked metadata afterward', async () => {
    const db = makeFakeDb()
    const created = await createApiKey(db, { userId: 1, name: 'my key', scopes: ['RESEARCH_READ'] })
    expect(created.plaintextKey).toContain('.')

    const listed = await listApiKeys(db, 1)
    expect(listed).toHaveLength(1)
    expect(listed[0].maskedPrefix).not.toBe(created.keyPrefix)
    expect(JSON.stringify(listed[0])).not.toContain(created.plaintextKey.split('.')[1])
  })
})

describe('revokeApiKey', () => {
  it('sets revokedAt and reports NOT_FOUND for an unknown id', async () => {
    const db = makeFakeDb()
    const created = await createApiKey(db, { userId: 1, name: 'k', scopes: ['RESEARCH_READ'] })

    const result = await revokeApiKey(db, created.id)
    expect(result.ok).toBe(true)

    const missing = await revokeApiKey(db, 99999)
    expect(missing).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })
})

describe('authenticateApiKey', () => {
  async function setup(scopes: ApiKeyScope[] = ['RESEARCH_READ'], tier: 'FREE' | 'PRO' | 'RESEARCH' = 'RESEARCH') {
    const db = makeFakeDb([], { 1: tier })
    const created = await createApiKey(db, { userId: 1, name: 'k', scopes })
    return { db, created }
  }

  it('accepts a correct key for an entitled, scoped, enabled request', async () => {
    const { db, created } = await setup()
    const result = await authenticateApiKey(db, created.plaintextKey, 'RESEARCH_READ', true)
    expect(result.ok).toBe(true)
  })

  it('rejects an unparseable key as INVALID without a database round trip mattering', async () => {
    const db = makeFakeDb()
    const result = await authenticateApiKey(db, 'not-a-valid-key', 'RESEARCH_READ', true)
    expect(result).toEqual({ ok: false, status: 401, reason: 'INVALID' })
  })

  it('rejects an unknown prefix as INVALID', async () => {
    const db = makeFakeDb()
    const result = await authenticateApiKey(db, 'unknownprefix.somesecret', 'RESEARCH_READ', true)
    expect(result).toEqual({ ok: false, status: 401, reason: 'INVALID' })
  })

  it('rejects a known prefix with the wrong secret as INVALID, but includes keyId internally', async () => {
    const { db, created } = await setup()
    const [prefix] = created.plaintextKey.split('.')
    const result = await authenticateApiKey(db, `${prefix}.wrongsecret000000000000000000000000000000000000`, 'RESEARCH_READ', true)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.reason).toBe('INVALID')
      expect(result.keyId).toBe(created.id)
    }
  })

  it('rejects a revoked key as REVOKED (401, not 403 — indistinguishable from invalid to the caller)', async () => {
    const { db, created } = await setup()
    await revokeApiKey(db, created.id)
    const result = await authenticateApiKey(db, created.plaintextKey, 'RESEARCH_READ', true)
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'REVOKED' })
  })

  it('rejects an expired key as EXPIRED', async () => {
    const db = makeFakeDb([], { 1: 'RESEARCH' })
    const created = await createApiKey(db, { userId: 1, name: 'k', scopes: ['RESEARCH_READ'], expiresAt: new Date(Date.now() - 1000) })
    const result = await authenticateApiKey(db, created.plaintextKey, 'RESEARCH_READ', true)
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'EXPIRED' })
  })

  it('rejects a valid key whose owner no longer holds RESEARCH tier as WRONG_TIER (403, not 401)', async () => {
    const { db, created } = await setup(['RESEARCH_READ'], 'PRO')
    const result = await authenticateApiKey(db, created.plaintextKey, 'RESEARCH_READ', true)
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'WRONG_TIER' })
  })

  it('rejects a valid, entitled key missing the required scope as MISSING_SCOPE (403)', async () => {
    const { db, created } = await setup(['RESEARCH_READ'])
    const result = await authenticateApiKey(db, created.plaintextKey, 'RESEARCH_EXPORT', true)
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'MISSING_SCOPE' })
  })

  it('rejects when the feature flag is disabled as FEATURE_DISABLED (403), even with a perfectly valid key', async () => {
    const { db, created } = await setup()
    const result = await authenticateApiKey(db, created.plaintextKey, 'RESEARCH_READ', false)
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'FEATURE_DISABLED' })
  })
})

// Sanity check that hashSecret's own guarantee (deterministic per input)
// holds — authenticateApiKey's lookup-by-prefix strategy depends on it.
describe('hashSecret determinism (load-bearing for lookup-by-prefix)', () => {
  it('produces the same hash for the same input every time', () => {
    expect(hashSecret('same-input')).toBe(hashSecret('same-input'))
  })
})
