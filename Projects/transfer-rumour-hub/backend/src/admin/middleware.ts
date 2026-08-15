import type { Response, NextFunction } from 'express'
import type { AuthedRequest } from '../middleware/auth.js'
import type { AdminDb } from './db.js'

// Replaces the shared-secret ADMIN_TOKEN check (retired — see
// docs/public-beta-readiness-audit.md and docs/admin-operations.md). Must
// run after requireAuth/optionalAuth so req.userId is populated; unlike
// entitlements/middleware.ts's requireEntitlement, this does NOT treat an
// anonymous request as anything — admin routes have no "degrade to a
// lower tier" concept, they're authenticated-only.
//
// Re-reads User.role from the database on every request rather than
// trusting a value embedded in the JWT, same reasoning as
// requireEntitlement re-reading tier: a demoted admin loses access
// immediately, not at token expiry.
export function requireAdmin(db: AdminDb) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const user = await db.user.findUnique({ where: { id: req.userId }, select: { role: true } })
    if (!user || user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Admin role required' })
      return
    }

    next()
  }
}
