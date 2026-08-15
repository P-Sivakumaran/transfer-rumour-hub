import type { Response } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { listClaims, getClaimById } from '../evidence/claimsService.js'
import { getClaimProvenance } from '../evidence/evidenceService.js'
import type { EvidenceDb } from '../evidence/db.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { checkEntitlement } from '../entitlements/resolver.js'
import type { EntitlementTier } from '../entitlements/flags.js'
import { logProductEvent } from '../analytics/events.js'
import { logOperationalEvent, type OperationalEventDb } from '../analytics/operationalEvents.js'
import type { CorrelatedRequest } from '../lib/correlationId.js'

const prisma = new PrismaClient()
const db = prisma as unknown as EvidenceDb
const opDb = prisma as unknown as OperationalEventDb

async function tierOf(userId: number | undefined): Promise<EntitlementTier> {
  if (!userId) return 'FREE'
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } })
  return user?.tier ?? 'FREE'
}

const ListQuerySchema = z.object({
  playerId: z.coerce.number().optional(),
  status: z.enum(['ACTIVE', 'DENIED', 'SUPERSEDED', 'CONFIRMED', 'EXPIRED']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  // Advanced filter (Pro) — minimum source tier (1 = best). Silently
  // ignored for users who aren't entitled, rather than 403ing the whole
  // list: GET /claims must stay usable for everyone, the extra filter
  // dimension just doesn't apply. See docs/monetisation-proposal.md.
  sourceTierAtBest: z.coerce.number().min(1).max(5).optional(),
})

export async function handleListClaims(req: AuthedRequest, res: Response): Promise<void> {
  const { playerId, status, page, limit, sourceTierAtBest } = ListQuerySchema.parse(req.query)

  let appliedSourceTierAtBest: number | undefined
  if (sourceTierAtBest !== undefined) {
    const tier = await tierOf(req.userId)
    const check = checkEntitlement(tier, 'ADVANCED_FILTERS')
    if (check.allowed) {
      appliedSourceTierAtBest = sourceTierAtBest
    } else {
      const correlationId = (req as CorrelatedRequest).correlationId ?? null
      if (check.reason === 'FEATURE_DISABLED') {
        await logOperationalEvent(opDb, { eventType: 'FEATURE_FLAG_DENIED', featureKey: 'ADVANCED_FILTERS' }, correlationId)
      } else {
        await logOperationalEvent(
          opDb,
          { eventType: 'ENTITLEMENT_DENIED', featureKey: 'ADVANCED_FILTERS', requiredTier: check.requiredTier, currentTier: tier },
          correlationId,
        )
      }
    }
  }

  const result = await listClaims(db, { playerId, claimStatus: status, page, limit, sourceTierAtBest: appliedSourceTierAtBest })
  res.json(result)
}

// Requirement 6: evidence count, independent-source count, original vs.
// syndicated grouping, official confirmation/denial — all in one response,
// alongside the base Claim fields. This is a new endpoint, not a change to
// GET /rumours/:id — see README/docs/forecasting-audit.md for why the
// existing rumour API contract is left untouched.
//
// Deliberately NOT entitlement-gated — evidence visibility, including
// contradicting/denial evidence, is never tier-gated. See
// docs/monetisation-proposal.md "Why TransferHub must not sell certainty
// or hide conflicting evidence."
export async function handleGetClaim(req: AuthedRequest, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }

  const claim = await getClaimById(db, id)
  if (!claim) {
    res.status(404).json({ error: 'Claim not found' })
    return
  }

  const provenance = await getClaimProvenance(db, id)
  res.json({ ...claim, ...provenance })
}

// GET /claims/:id/forecast-history — every past ClaimForecast for this
// claim, oldest first. Powers the frontend's forecast-over-time chart.
// Separate from GET /claims/:id/forecast (which produces a NEW prediction
// and is never gated — the forecast value itself is free, see
// docs/monetisation-proposal.md). This only reads what's already
// persisted, gated by FORECAST_HISTORY (Pro). Anonymous requests are
// treated as Free tier, not rejected outright — see
// entitlements/middleware.ts.
export async function handleGetClaimForecastHistory(req: AuthedRequest, res: Response): Promise<void> {
  const claimId = parseInt(req.params.id, 10)
  if (Number.isNaN(claimId)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }

  const tier = await tierOf(req.userId)
  const check = checkEntitlement(tier, 'FORECAST_HISTORY')
  if (!check.allowed) {
    const correlationId = (req as CorrelatedRequest).correlationId ?? null
    if (check.reason === 'FEATURE_DISABLED') {
      await logOperationalEvent(opDb, { eventType: 'FEATURE_FLAG_DENIED', featureKey: 'FORECAST_HISTORY' }, correlationId)
    } else {
      await logOperationalEvent(
        opDb,
        { eventType: 'ENTITLEMENT_DENIED', featureKey: 'FORECAST_HISTORY', requiredTier: check.requiredTier, currentTier: tier },
        correlationId,
      )
    }
    res.status(403).json({ error: 'Entitlement required', reason: check.reason, requiredTier: check.requiredTier, currentTier: tier })
    return
  }

  const history = await prisma.claimForecast.findMany({
    where: { claimId },
    orderBy: { predictionTimestamp: 'asc' },
    select: {
      predictionTimestamp: true,
      calibratedProbability: true,
      uncertaintyLow: true,
      uncertaintyHigh: true,
      displayMode: true,
      rawScore: true,
    },
  })

  await logProductEvent(prisma, req.userId ?? null, 'FORECAST_HISTORY_VIEWED', { tier })
  res.json(history)
}
