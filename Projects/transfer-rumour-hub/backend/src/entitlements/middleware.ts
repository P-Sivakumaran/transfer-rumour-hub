import type { Response, NextFunction } from 'express'
import type { AuthedRequest } from '../middleware/auth.js'
import type { EntitlementDb } from './db.js'
import { checkEntitlement } from './resolver.js'
import type { FeatureKey } from './flags.js'
import { logOperationalEvent, type OperationalEventDb } from '../analytics/operationalEvents.js'
import type { CorrelatedRequest } from '../lib/correlationId.js'

export interface EntitledRequest extends AuthedRequest {
  entitlementTier?: 'FREE' | 'PRO' | 'RESEARCH'
}

// Server-side entitlement gate (requirement 3 — "do not rely only on
// frontend gating"). Anonymous requests (no req.userId) are treated as
// FREE tier rather than rejected with 401: the point of this middleware is
// upgrade messaging, not authentication. Routes that also require a login
// (e.g. watchlist mutation) already run requireAuth first in their own
// router chain — this middleware doesn't duplicate that decision.
//
// Must run after requireAuth/optionalAuth so req.userId is populated when
// present.
export function requireEntitlement(db: EntitlementDb & OperationalEventDb, featureKey: FeatureKey) {
  return async (req: EntitledRequest, res: Response, next: NextFunction): Promise<void> => {
    const tier = req.userId ? (await db.user.findUnique({ where: { id: req.userId }, select: { tier: true } }))?.tier ?? 'FREE' : 'FREE'

    const check = checkEntitlement(tier, featureKey)
    req.entitlementTier = tier

    if (!check.allowed) {
      const correlationId = (req as CorrelatedRequest).correlationId ?? null
      // Two distinct operational event types for the two distinct denial
      // layers (docs/monetisation-proposal.md's tier-vs-flag resolver) —
      // "not on this plan" and "temporarily disabled for everyone" are
      // different operational signals, not the same event with a different
      // label.
      if (check.reason === 'FEATURE_DISABLED') {
        await logOperationalEvent(db, { eventType: 'FEATURE_FLAG_DENIED', featureKey }, correlationId)
      } else {
        await logOperationalEvent(db, { eventType: 'ENTITLEMENT_DENIED', featureKey, requiredTier: check.requiredTier, currentTier: tier }, correlationId)
      }

      res.status(403).json({
        error: 'Entitlement required',
        reason: check.reason,
        requiredTier: check.requiredTier,
        currentTier: tier,
      })
      return
    }

    next()
  }
}
