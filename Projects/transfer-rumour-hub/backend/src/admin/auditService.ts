import type { AdminAuditDb } from './db.js'
import type { EntitlementTier, EntitlementSource } from '../entitlements/flags.js'

export interface RecordEntitlementGrantInput {
  actingAdminUserId: number
  targetUserId: number
  previousTier: EntitlementTier
  newTier: EntitlementTier
  entitlementSource: EntitlementSource
  correlationId?: string | null
}

// Immutable audit trail — this is the only write path to AdminAuditEvent
// anywhere in this codebase (no update/delete call exists). Called only on
// a successful grant, since previousTier/newTier only mean something for a
// completed change; failed attempts go through
// analytics/operationalEvents.ts's ADMIN_TIER_GRANT_FAILURE instead (a
// separate, non-audit channel — see docs/public-beta-readiness-audit.md).
export async function recordEntitlementGrant(db: AdminAuditDb, input: RecordEntitlementGrantInput): Promise<void> {
  await db.adminAuditEvent.create({
    data: {
      actingAdminUserId: input.actingAdminUserId,
      actionType: 'ENTITLEMENT_GRANT',
      targetUserId: input.targetUserId,
      previousTier: input.previousTier,
      newTier: input.newTier,
      entitlementSource: input.entitlementSource,
      correlationId: input.correlationId ?? null,
    },
  })
}
