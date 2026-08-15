// Security/operational event log — deliberately separate from
// analytics/events.ts's ProductEvent (product analytics). No userId FK:
// these are structured diagnostic events tied to a request via
// correlationId, not a per-user behavioral log. See
// docs/public-beta-readiness-audit.md and docs/data-retention.md.

export type OperationalEventType =
  | 'ENTITLEMENT_DENIED'
  | 'FEATURE_FLAG_DENIED'
  | 'WATCHLIST_CAP_REACHED'
  | 'API_KEY_ACCEPTED'
  | 'API_KEY_REJECTED'
  | 'API_KEY_RATE_LIMITED'
  | 'ADMIN_TIER_GRANT_SUCCESS'
  | 'ADMIN_TIER_GRANT_FAILURE'
  | 'RETENTION_PURGE_SUCCESS'
  | 'RETENTION_PURGE_FAILURE'

export interface OperationalEventDb {
  operationalEvent: {
    create: (args: { data: { eventType: OperationalEventType; correlationId: string | null; detail?: object } }) => Promise<unknown>
  }
}

// Each variant has its own narrow field set — the same "make the schema
// incapable of carrying the sensitive field" pattern used for
// ProductEvent's PROVENANCE_PANEL_VIEWED (verified live last session: a
// caller-supplied claimId is stripped before it reaches the DB, not just
// conventionally omitted). No variant here accepts a free-form object or a
// claimId/playerId field, so there's no field to smuggle one into.
export type OperationalEventInput =
  | { eventType: 'ENTITLEMENT_DENIED'; featureKey: string; requiredTier: string; currentTier: string }
  | { eventType: 'FEATURE_FLAG_DENIED'; featureKey: string }
  | { eventType: 'WATCHLIST_CAP_REACHED'; limit: number }
  | { eventType: 'API_KEY_ACCEPTED'; keyId: number; scope: string }
  | {
      eventType: 'API_KEY_REJECTED'
      reason: 'INVALID' | 'EXPIRED' | 'REVOKED' | 'MISSING_SCOPE' | 'WRONG_TIER' | 'FEATURE_DISABLED'
      keyId?: number
    }
  | { eventType: 'API_KEY_RATE_LIMITED'; keyId: number }
  | { eventType: 'ADMIN_TIER_GRANT_SUCCESS'; targetUserId: number; newTier: string }
  | { eventType: 'ADMIN_TIER_GRANT_FAILURE'; reason: string }
  | { eventType: 'RETENTION_PURGE_SUCCESS'; deletedCount: number }
  | { eventType: 'RETENTION_PURGE_FAILURE'; reason: string }

export async function logOperationalEvent(
  db: OperationalEventDb,
  event: OperationalEventInput,
  correlationId?: string | null,
): Promise<void> {
  const { eventType, ...detail } = event
  await db.operationalEvent.create({ data: { eventType, correlationId: correlationId ?? null, detail } })
}
