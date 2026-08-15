import { describe, it, expect } from 'vitest'
import type { Response } from 'express'
import { requireEntitlement, type EntitledRequest } from './middleware.js'
import type { EntitlementDb } from './db.js'
import type { EntitlementTier } from './flags.js'
import type { OperationalEventDb } from '../analytics/operationalEvents.js'

function fakeDb(users: Record<number, EntitlementTier>): EntitlementDb & OperationalEventDb & { opEvents: unknown[] } {
  const opEvents: unknown[] = []
  return {
    opEvents,
    user: {
      findUnique: async ({ where }) => {
        const tier = users[where.id]
        return tier ? { tier } : null
      },
    },
    operationalEvent: {
      create: async (args) => {
        opEvents.push(args.data)
        return args.data
      },
    },
  }
}

function fakeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res
}

describe('requireEntitlement', () => {
  it('lets an entitled Pro user through', async () => {
    const db = fakeDb({ 1: 'PRO' })
    const mw = requireEntitlement(db, 'FORECAST_HISTORY')
    const req = { userId: 1 } as EntitledRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => {
      called = true
    })
    expect(called).toBe(true)
    expect(res.statusCode).toBeUndefined()
    expect(req.entitlementTier).toBe('PRO')
  })

  it('403s a Free user on a Pro-gated feature, without calling next, and logs ENTITLEMENT_DENIED', async () => {
    const db = fakeDb({ 1: 'FREE' })
    const mw = requireEntitlement(db, 'FORECAST_HISTORY')
    const req = { userId: 1 } as EntitledRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => {
      called = true
    })
    expect(called).toBe(false)
    expect(res.statusCode).toBe(403)
    expect((res.body as { reason: string }).reason).toBe('INSUFFICIENT_TIER')
    expect(db.opEvents[0]).toMatchObject({ eventType: 'ENTITLEMENT_DENIED' })
  })

  it('treats an anonymous request (no userId) as Free tier rather than throwing or 401ing', async () => {
    const db = fakeDb({})
    const mw = requireEntitlement(db, 'FORECAST_HISTORY')
    const req = {} as EntitledRequest
    const res = fakeRes()
    await mw(req, res, () => {})
    expect(res.statusCode).toBe(403)
    expect((res.body as { currentTier: string }).currentTier).toBe('FREE')
  })

  it('logs FEATURE_FLAG_DENIED (not ENTITLEMENT_DENIED) when the tier qualifies but the flag is off', async () => {
    // CSV_EXPORT_WATCHLIST requires PRO and defaults to disabled — a PRO
    // user should be denied by the flag layer, not the tier layer.
    const db = fakeDb({ 1: 'PRO' })
    const mw = requireEntitlement(db, 'CSV_EXPORT_WATCHLIST')
    const req = { userId: 1 } as EntitledRequest
    const res = fakeRes()
    await mw(req, res, () => {})
    expect(res.statusCode).toBe(403)
    expect((res.body as { reason: string }).reason).toBe('FEATURE_DISABLED')
    expect(db.opEvents[0]).toMatchObject({ eventType: 'FEATURE_FLAG_DENIED' })
  })
})
