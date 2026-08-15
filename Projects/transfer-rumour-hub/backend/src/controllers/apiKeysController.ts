import type { Response } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import type { AuthedRequest } from '../middleware/auth.js'
import { createApiKey, listApiKeys } from '../apiKeys/service.js'
import type { ApiKeyDb, ApiKeyScope } from '../apiKeys/db.js'

const prisma = new PrismaClient()
const db = prisma as unknown as ApiKeyDb

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(['RESEARCH_READ', 'RESEARCH_EXPORT'])).min(1),
  expiresAt: z.coerce.date().optional(),
})

// POST /api-keys — self-service creation for the owning RESEARCH-tier
// user. Checked live against the current tier, not just at some past grant
// time, same "re-read per request" reasoning as everywhere else in this
// entitlement model.
export async function handleCreateApiKey(req: AuthedRequest, res: Response): Promise<void> {
  const owner = await prisma.user.findUnique({ where: { id: req.userId! }, select: { tier: true } })
  if (owner?.tier !== 'RESEARCH') {
    res.status(403).json({ error: 'Research tier required to create API keys' })
    return
  }

  const parsed = CreateSchema.parse(req.body)
  const key = await createApiKey(db, {
    userId: req.userId!,
    name: parsed.name,
    scopes: parsed.scopes as ApiKeyScope[],
    expiresAt: parsed.expiresAt ?? null,
  })

  // The only response, ever, containing the plaintext key — not persisted,
  // not logged. See apiKeys/service.ts.
  res.status(201).json({
    id: key.id,
    name: key.name,
    scopes: key.scopes,
    keyPrefix: key.keyPrefix,
    key: key.plaintextKey,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    warning: 'Store this key now — it will not be shown again.',
  })
}

// GET /api-keys — owner-visible listing, masked prefixes and metadata
// only (requirement: never expose secret material after creation).
export async function handleListApiKeys(req: AuthedRequest, res: Response): Promise<void> {
  const keys = await listApiKeys(db, req.userId!)
  res.json(keys)
}
