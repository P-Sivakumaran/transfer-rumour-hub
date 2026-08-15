import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response } from 'express'
import { requireApiKey, type ApiKeyRequest } from './middleware.js'
import { createApiKey } from './service.js'
import type { ApiKeyDb, ApiKeyRow, ApiKeyUsageDb } from './db.js'
import type { OperationalEventDb } from '../analytics/operationalEvents.js'

function makeFakeDb(tiers: Record<number, 'FREE' | 'PRO' | 'RESEARCH'>) {
  const rows: ApiKeyRow[] = []
  const usageEvents: unknown[] = []
  const opEvents: unknown[] = []
  let nextId = 1

  const db: ApiKeyDb & ApiKeyUsageDb & OperationalEventDb = {
    apiKey: {
      create: async ({ data }) => {
        const row: ApiKeyRow = { id: nextId++, ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null }
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
    apiKeyUsageEvent: { create: async (args) => { usageEvents.push(args.data); return args.data } },
    operationalEvent: { create: async (args) => { opEvents.push(args.data); return args.data } },
  }
  return { db, usageEvents, opEvents }
}

type FakeRes = Response & { statusCode?: number; body?: unknown; headers: Record<string, string> }

function fakeRes(): FakeRes {
  const res = { headers: {} } as FakeRes
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (body: unknown) => { res.body = body; return res }
  res.setHeader = ((name: string, value: string) => {
    res.headers[name] = value
    return res
  }) as unknown as FakeRes['setHeader']
  return res
}

describe('requireApiKey', () => {
  beforeEach(() => {
    vi.stubEnv('FEATURE_HISTORICAL_DATASETS', 'true')
  })

  it('401s a request with no Authorization header, generic body, no keyId leaked', async () => {
    const { db, opEvents } = makeFakeDb({})
    const mw = requireApiKey(db, { scope: 'RESEARCH_READ', featureKey: 'HISTORICAL_DATASETS', endpointCategory: 'HISTORICAL_CLAIMS' })
    const req = { header: () => undefined } as unknown as ApiKeyRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => { called = true })
    expect(called).toBe(false)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'Missing or invalid API key' })
    expect(opEvents[0]).toMatchObject({ eventType: 'API_KEY_REJECTED', detail: { reason: 'INVALID' } })
    expect((opEvents[0] as { detail: object }).detail).not.toHaveProperty('keyId')
  })

  it('accepts a valid key for an entitled RESEARCH user and calls next, attaching req.apiKey', async () => {
    const { db } = makeFakeDb({ 1: 'RESEARCH' })
    const created = await createApiKey(db, { userId: 1, name: 'k', scopes: ['RESEARCH_READ'] })
    const mw = requireApiKey(db, { scope: 'RESEARCH_READ', featureKey: 'HISTORICAL_DATASETS', endpointCategory: 'HISTORICAL_CLAIMS' })
    const req = { header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${created.plaintextKey}` : undefined) } as unknown as ApiKeyRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => { called = true })
    expect(called).toBe(true)
    expect(req.apiKey?.id).toBe(created.id)
  })

  it('403s a valid key belonging to a non-RESEARCH-tier owner', async () => {
    const { db } = makeFakeDb({ 1: 'PRO' })
    const created = await createApiKey(db, { userId: 1, name: 'k', scopes: ['RESEARCH_READ'] })
    const mw = requireApiKey(db, { scope: 'RESEARCH_READ', featureKey: 'HISTORICAL_DATASETS', endpointCategory: 'HISTORICAL_CLAIMS' })
    const req = { header: () => `Bearer ${created.plaintextKey}` } as unknown as ApiKeyRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => { called = true })
    expect(called).toBe(false)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'API key not authorized for this resource' })
  })

  it('401s a revoked key with the same generic body as an invalid one (non-enumerating)', async () => {
    const { db } = makeFakeDb({ 1: 'RESEARCH' })
    const created = await createApiKey(db, { userId: 1, name: 'k', scopes: ['RESEARCH_READ'] })
    await db.apiKey.update({ where: { id: created.id }, data: { revokedAt: new Date() } })
    const mw = requireApiKey(db, { scope: 'RESEARCH_READ', featureKey: 'HISTORICAL_DATASETS', endpointCategory: 'HISTORICAL_CLAIMS' })
    const req = { header: () => `Bearer ${created.plaintextKey}` } as unknown as ApiKeyRequest
    const res = fakeRes()
    await mw(req, res, () => {})
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'Missing or invalid API key' })
  })
})
