import { Router } from 'express'
import { PrismaClient, RumourStatus } from '@prisma/client'
import { applyOutcome } from '../ingestion/outcomeDetector.js'
import { enrichQueue, playerSyncQueue } from '../queue/queues.js'
import { broadcast } from '../sse/broadcaster.js'
import { z } from 'zod'
import { optionalAuth, type AuthedRequest } from '../middleware/auth.js'
import { requireAdmin } from '../admin/middleware.js'
import { recordEntitlementGrant } from '../admin/auditService.js'
import type { AdminDb, AdminAuditDb } from '../admin/db.js'
import { rateLimitMiddleware } from '../lib/rateLimit.js'
import { logOperationalEvent } from '../analytics/operationalEvents.js'
import type { OperationalEventDb } from '../analytics/operationalEvents.js'
import type { CorrelatedRequest } from '../lib/correlationId.js'
import { revokeApiKey } from '../apiKeys/service.js'
import type { ApiKeyDb } from '../apiKeys/db.js'

const router = Router()
const prisma = new PrismaClient()
const adminDb = prisma as unknown as AdminDb
const adminAuditDb = prisma as unknown as AdminAuditDb
const opDb = prisma as unknown as OperationalEventDb
const apiKeyDb = prisma as unknown as ApiKeyDb

// All routes on this router require an authenticated ADMIN — closed under
// docs/polp-security-dev-plan.md Phase 1 (previously 5 of 10 routes had no
// auth at all, a pre-existing gap restated in
// docs/public-beta-readiness-audit.md). requireAuth's frontend caller
// (frontend/src/lib/api.ts's `admin` object) already sends the session
// cookie on every one of these calls, so gating them doesn't change
// behavior for a logged-in admin — it just stops an unauthenticated caller.
//
// The shared-secret ADMIN_TOKEN check that used to guard the entitlement
// route has been retired entirely (not kept as a disabled-by-default
// fallback) — two parallel admin-auth paths is more attack surface for the
// same capability, and nothing else in the codebase referenced it. See
// docs/admin-operations.md for the bootstrap flow that replaces it.
//
// optionalAuth populates req.userId (when a valid session cookie is
// present); requireAdmin then re-reads role from the DB and 401s/403s.
router.use(optionalAuth)
router.use(requireAdmin(adminDb))

const outcomeSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED', 'DENIED']),
})

// PATCH /admin/rumours/:id/outcome — manually set transfer outcome
router.patch('/rumours/:id/outcome', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return }

  const parsed = outcomeSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid body', details: parsed.error.errors }); return }

  await applyOutcome(id, parsed.data.status, prisma, true)

  const rumour = await prisma.rumour.findUnique({ where: { id } })
  broadcast('rumour:updated', { id, status: parsed.data.status, computedLikelihood: rumour?.computedLikelihood })

  res.json({ id, status: parsed.data.status })
})

// GET /admin/sources — list sources with reliability stats
router.get('/sources', async (_req, res) => {
  const sources = await prisma.source.findMany({
    orderBy: { reliabilityScore: 'desc' },
    select: {
      id: true, name: true, type: true, reliabilityScore: true,
      hitCount: true, missCount: true, country: true, url: true,
      _count: { select: { rumours: true } },
    },
  })
  res.json(sources)
})

// POST /admin/players/:id/enrich — trigger manual Wikidata enrichment
router.post('/players/:id/enrich', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return }

  const player = await prisma.player.findUnique({ where: { id }, select: { name: true } })
  if (!player) { res.status(404).json({ error: 'Player not found' }); return }

  await enrichQueue.add('enrich', { playerId: id, playerName: player.name })
  res.json({ queued: true, playerId: id, playerName: player.name })
})

// POST /admin/players/sync — trigger a Sportmonks squad sync on demand
// (testing without waiting for the daily schedule)
router.post('/players/sync', async (_req, res) => {
  const job = await playerSyncQueue.add('player-sync-manual', {})
  res.json({ queued: true, jobId: job.id })
})

// GET /admin/rumours?status=PENDING — list rumours filtered by status (for review)
// Evidence (the source articles) is attached to each row so a status change
// is always made against visible source text, not a bare likelihood number.
router.get('/rumours', async (req, res) => {
  const status = req.query.status as RumourStatus | undefined
  const where = status && Object.values(RumourStatus).includes(status) ? { status } : {}
  const rumours = await prisma.rumour.findMany({
    where,
    orderBy: { computedLikelihood: 'desc' },
    take: 50,
    include: {
      player: { select: { name: true } },
      fromClub: { select: { name: true } },
      toClub: { select: { name: true } },
      source: { select: { name: true, reliabilityScore: true } },
    },
  })

  const rumourIds = rumours.map((r) => r.id)
  const evidenceRows = rumourIds.length
    ? await prisma.rawSignal.findMany({
        where: { rumourId: { in: rumourIds } },
        orderBy: { publishedAt: 'desc' },
        select: { rumourId: true, sourceName: true, headline: true, link: true, publishedAt: true },
      })
    : []

  const evidenceByRumour = new Map<number, typeof evidenceRows>()
  for (const row of evidenceRows) {
    const list = evidenceByRumour.get(row.rumourId!) ?? []
    list.push(row)
    evidenceByRumour.set(row.rumourId!, list)
  }

  res.json(rumours.map((r) => ({ ...r, evidence: evidenceByRumour.get(r.id) ?? [] })))
})

const entitlementSchema = z.object({
  tier: z.enum(['FREE', 'PRO', 'RESEARCH']),
})

// POST /admin/users/:id/entitlement — manual entitlement grant. This is how
// a user's tier changes in this implementation: no payment provider exists
// (docs/monetisation-proposal.md — "works without a billing provider" is
// the explicit requirement this endpoint satisfies). Gated by requireAdmin
// (authenticated ADMIN role — see docs/admin-operations.md for how a user
// gets that role) and rate-limited per acting admin, since this is the
// highest-consequence write in the app: it grants purchasing power with no
// purchase. Every successful grant is recorded in AdminAuditEvent,
// immutably — see admin/auditService.ts.
router.post(
  '/users/:id/entitlement',
  rateLimitMiddleware({
    keyFn: (req: AuthedRequest) => `admin-grant:${req.userId}`,
    limit: 20,
    windowSeconds: 60,
    failureMode: 'CLOSED',
  }),
  async (req: AuthedRequest, res) => {
    const correlationId = (req as CorrelatedRequest).correlationId ?? null
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return }

    const parsed = entitlementSchema.safeParse(req.body)
    if (!parsed.success) {
      await logOperationalEvent(opDb, { eventType: 'ADMIN_TIER_GRANT_FAILURE', reason: 'INVALID_TIER' }, correlationId)
      res.status(400).json({ error: 'Invalid body', details: parsed.error.errors })
      return
    }

    const before = await prisma.user.findUnique({ where: { id }, select: { tier: true } })
    if (!before) {
      await logOperationalEvent(opDb, { eventType: 'ADMIN_TIER_GRANT_FAILURE', reason: 'USER_NOT_FOUND' }, correlationId)
      res.status(404).json({ error: 'User not found' })
      return
    }

    const user = await prisma.user.update({
      where: { id },
      data: { tier: parsed.data.tier, entitlementSource: 'MANUAL', entitlementGrantedAt: new Date() },
      select: { id: true, email: true, tier: true, entitlementSource: true, entitlementGrantedAt: true },
    })

    await recordEntitlementGrant(adminAuditDb, {
      actingAdminUserId: req.userId!,
      targetUserId: id,
      previousTier: before.tier,
      newTier: user.tier,
      entitlementSource: user.entitlementSource,
      correlationId,
    })
    await logOperationalEvent(opDb, { eventType: 'ADMIN_TIER_GRANT_SUCCESS', targetUserId: id, newTier: user.tier }, correlationId)

    res.json(user)
  },
)

// POST /admin/api-keys/:id/revoke — admin-only per the Research API-key
// spec (owner-visible listing is separate, see routes/apiKeys.ts; owners
// cannot revoke their own keys through this app, only view them).
router.post('/api-keys/:id/revoke', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return }

  const result = await revokeApiKey(apiKeyDb, id)
  if (!result.ok) { res.status(404).json({ error: 'API key not found' }); return }

  res.status(204).end()
})

// GET /admin/purge-health — the "basic health-checkable last successful
// purge record" the retention job requirement asks for. Single row, see
// analytics/retention.ts / schema.prisma's PurgeHealth comment.
router.get('/purge-health', async (_req, res) => {
  const health = await prisma.purgeHealth.findUnique({ where: { id: 1 } })
  if (!health) {
    res.json({ lastRunStartedAt: null, lastRunCompletedAt: null, lastRunSucceeded: null, lastDeletedCount: null, lastCutoff: null, lastError: null })
    return
  }
  res.json(health)
})

export default router
