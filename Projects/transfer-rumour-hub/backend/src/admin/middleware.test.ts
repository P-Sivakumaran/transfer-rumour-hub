import { describe, it, expect } from 'vitest'
import type { Response } from 'express'
import { requireAdmin } from './middleware.js'
import type { AdminDb, Role } from './db.js'
import type { AuthedRequest } from '../middleware/auth.js'

function fakeDb(users: Record<number, Role>): AdminDb {
  return {
    user: {
      findUnique: async ({ where }) => {
        const role = users[where.id]
        return role ? { role } : null
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

describe('requireAdmin', () => {
  it('401s an unauthenticated request (no userId) without touching the database', async () => {
    const db = fakeDb({})
    const mw = requireAdmin(db)
    const req = {} as AuthedRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => {
      called = true
    })
    expect(called).toBe(false)
    expect(res.statusCode).toBe(401)
  })

  it('403s an authenticated non-admin user', async () => {
    const db = fakeDb({ 1: 'USER' })
    const mw = requireAdmin(db)
    const req = { userId: 1 } as AuthedRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => {
      called = true
    })
    expect(called).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it('lets an authenticated admin through', async () => {
    const db = fakeDb({ 1: 'ADMIN' })
    const mw = requireAdmin(db)
    const req = { userId: 1 } as AuthedRequest
    const res = fakeRes()
    let called = false
    await mw(req, res, () => {
      called = true
    })
    expect(called).toBe(true)
    expect(res.statusCode).toBeUndefined()
  })

  it('403s when the authenticated user id no longer exists (e.g. deleted between token issue and request)', async () => {
    const db = fakeDb({})
    const mw = requireAdmin(db)
    const req = { userId: 999 } as AuthedRequest
    const res = fakeRes()
    await mw(req, res, () => {})
    expect(res.statusCode).toBe(403)
  })
})
