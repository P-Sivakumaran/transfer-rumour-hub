/**
 * Integration test — real Postgres + real Redis + isolated HTTP server,
 * same pattern as admin.integration.test.ts. Exercises key creation,
 * listing, live use against /research/*, and admin revocation end-to-end.
 */
process.env.FEATURE_HISTORICAL_DATASETS = 'true'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'express-async-errors'
import express from 'express'
import cookieParser from 'cookie-parser'
import type { Server } from 'http'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import apiKeysRouter from './apiKeys.js'
import researchRouter from './research.js'
import adminRouter from './admin.js'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'
const prisma = new PrismaClient()
const RUN_ID = `APK${Date.now()}`

let server: Server
let baseUrl: string
let researchUserId: number
let proUserId: number
let adminUserId: number

function cookieFor(userId: number): string {
  return `token=${jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' })}`
}

beforeAll(async () => {
  const researchUser = await prisma.user.create({
    data: { email: `${RUN_ID}-research@test.com`, passwordHash: 'x', role: 'USER', tier: 'RESEARCH' },
  })
  researchUserId = researchUser.id

  const proUser = await prisma.user.create({
    data: { email: `${RUN_ID}-pro@test.com`, passwordHash: 'x', role: 'USER', tier: 'PRO' },
  })
  proUserId = proUser.id

  const admin = await prisma.user.create({
    data: { email: `${RUN_ID}-admin@test.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  adminUserId = admin.id

  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api-keys', apiKeysRouter)
  app.use('/research', researchRouter)
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
  await prisma.apiKeyUsageEvent.deleteMany({ where: { apiKey: { userId: { in: [researchUserId, proUserId] } } } })
  await prisma.apiKey.deleteMany({ where: { userId: { in: [researchUserId, proUserId] } } })
  await prisma.user.deleteMany({ where: { id: { in: [researchUserId, proUserId, adminUserId] } } })
  await prisma.$disconnect()
})

describe('Research API keys — end to end', () => {
  it('403s key creation for a non-RESEARCH-tier user', async () => {
    const res = await fetch(`${baseUrl}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(proUserId) },
      body: JSON.stringify({ name: 'x', scopes: ['RESEARCH_READ'] }),
    })
    expect(res.status).toBe(403)
  })

  it('creates a key for a RESEARCH-tier user, showing the plaintext exactly once', async () => {
    const res = await fetch(`${baseUrl}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(researchUserId) },
      body: JSON.stringify({ name: 'read key', scopes: ['RESEARCH_READ'] }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { key: string; keyPrefix: string }
    expect(body.key).toContain('.')
    expect(body.key.startsWith(body.keyPrefix)).toBe(true)
  })

  it('lists the created key masked, without secret material', async () => {
    const res = await fetch(`${baseUrl}/api-keys`, { headers: { Cookie: cookieFor(researchUserId) } })
    expect(res.status).toBe(200)
    const keys = (await res.json()) as { maskedPrefix: string }[]
    expect(keys.length).toBeGreaterThan(0)
    expect(keys[0].maskedPrefix).toContain('*')
  })

  it('uses the key to successfully call a Research endpoint', async () => {
    const createRes = await fetch(`${baseUrl}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(researchUserId) },
      body: JSON.stringify({ name: 'usable key', scopes: ['RESEARCH_READ'] }),
    })
    const { key } = (await createRes.json()) as { key: string }

    const res = await fetch(`${baseUrl}/research/historical-claims`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('401s a request with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/research/historical-claims`)
    expect(res.status).toBe(401)
  })

  it('403s a key missing the required scope', async () => {
    const createRes = await fetch(`${baseUrl}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(researchUserId) },
      body: JSON.stringify({ name: 'export-only key', scopes: ['RESEARCH_EXPORT'] }),
    })
    const { key } = (await createRes.json()) as { key: string }

    const res = await fetch(`${baseUrl}/research/historical-claims`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(403)
  })

  it('401s a key after an admin revokes it', async () => {
    const createRes = await fetch(`${baseUrl}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(researchUserId) },
      body: JSON.stringify({ name: 'revoke-me key', scopes: ['RESEARCH_READ'] }),
    })
    const { id, key } = (await createRes.json()) as { id: number; key: string }

    const before = await fetch(`${baseUrl}/research/historical-claims`, { headers: { Authorization: `Bearer ${key}` } })
    expect(before.status).toBe(200)

    const revokeRes = await fetch(`${baseUrl}/admin/api-keys/${id}/revoke`, {
      method: 'POST',
      headers: { Cookie: cookieFor(adminUserId) },
    })
    expect(revokeRes.status).toBe(204)

    const after = await fetch(`${baseUrl}/research/historical-claims`, { headers: { Authorization: `Bearer ${key}` } })
    expect(after.status).toBe(401)
  })

  it('403s a non-admin attempting to revoke a key', async () => {
    const createRes = await fetch(`${baseUrl}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(researchUserId) },
      body: JSON.stringify({ name: 'protected key', scopes: ['RESEARCH_READ'] }),
    })
    const { id } = (await createRes.json()) as { id: number }

    const res = await fetch(`${baseUrl}/admin/api-keys/${id}/revoke`, {
      method: 'POST',
      headers: { Cookie: cookieFor(researchUserId) },
    })
    expect(res.status).toBe(403)
  })
})
