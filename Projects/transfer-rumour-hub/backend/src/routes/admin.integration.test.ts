/**
 * Integration test — real Postgres + real Redis + a real (isolated) HTTP
 * server, same "why this is the first of its kind" reasoning as
 * evidence.integration.test.ts documents for the DB-only case: this is the
 * repo's first test exercising Express middleware/routing end-to-end
 * (no supertest dependency exists here, so a real `app.listen` is used
 * instead — see docs/public-beta-readiness-audit.md §3/§4). Only the admin
 * router is mounted, not the full app, so this doesn't start BullMQ workers
 * or the RSS scheduler.
 *
 * Requires DATABASE_URL and REDIS_URL to point at running instances — same
 * requirement as every other integration test / the dev server itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'express-async-errors'
import express from 'express'
import cookieParser from 'cookie-parser'
import type { Server } from 'http'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import adminRouter from './admin.js'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'
const prisma = new PrismaClient()
const RUN_ID = `ADM${Date.now()}`

let server: Server
let baseUrl: string
let adminUserId: number
let nonAdminUserId: number
let targetUserId: number

function cookieFor(userId: number): string {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' })
  return `token=${token}`
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { email: `${RUN_ID}-admin@test.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  adminUserId = admin.id

  const nonAdmin = await prisma.user.create({
    data: { email: `${RUN_ID}-nonadmin@test.com`, passwordHash: 'x', role: 'USER' },
  })
  nonAdminUserId = nonAdmin.id

  const target = await prisma.user.create({
    data: { email: `${RUN_ID}-target@test.com`, passwordHash: 'x', role: 'USER', tier: 'FREE' },
  })
  targetUserId = target.id

  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/admin', adminRouter)
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err)
    res.status(500).json({ error: 'test-server error' })
  })

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.adminAuditEvent.deleteMany({ where: { targetUserId } })
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, nonAdminUserId, targetUserId] } } })
  await prisma.$disconnect()
})

describe('POST /admin/users/:id/entitlement', () => {
  it('401s with no session cookie', async () => {
    const res = await fetch(`${baseUrl}/admin/users/${targetUserId}/entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'PRO' }),
    })
    expect(res.status).toBe(401)
  })

  it('403s an authenticated non-admin user, including attempting to grant themself a higher tier', async () => {
    const res = await fetch(`${baseUrl}/admin/users/${nonAdminUserId}/entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(nonAdminUserId) },
      body: JSON.stringify({ tier: 'RESEARCH' }),
    })
    expect(res.status).toBe(403)

    const stillFree = await prisma.user.findUnique({ where: { id: nonAdminUserId }, select: { tier: true } })
    expect(stillFree?.tier).toBe('FREE')
  })

  it('400s an invalid tier value from an admin, without changing the target', async () => {
    const res = await fetch(`${baseUrl}/admin/users/${targetUserId}/entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(adminUserId) },
      body: JSON.stringify({ tier: 'GOLD' }),
    })
    expect(res.status).toBe(400)
  })

  it('grants successfully as admin and writes an immutable audit event', async () => {
    const res = await fetch(`${baseUrl}/admin/users/${targetUserId}/entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(adminUserId) },
      body: JSON.stringify({ tier: 'PRO' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tier: string }
    expect(body.tier).toBe('PRO')

    const audit = await prisma.adminAuditEvent.findFirst({
      where: { targetUserId, actingAdminUserId: adminUserId },
      orderBy: { id: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit?.previousTier).toBe('FREE')
    expect(audit?.newTier).toBe('PRO')
    expect(audit?.entitlementSource).toBe('MANUAL')
  })

  it('rate-limits repeated grant requests from the same admin', async () => {
    let sawRateLimited = false
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/admin/users/${targetUserId}/entitlement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieFor(adminUserId) },
        body: JSON.stringify({ tier: 'PRO' }),
      })
      if (res.status === 429) {
        sawRateLimited = true
        break
      }
    }
    expect(sawRateLimited).toBe(true)
  }, 20_000)
})
