import type { EntitlementTier, EntitlementSource } from '../entitlements/flags.js'

export type Role = 'USER' | 'ADMIN'

// Minimal injectable interfaces, same DI pattern as evidence/db.ts,
// forecasting/db.ts, entitlements/db.ts.
export interface AdminDb {
  user: {
    findUnique: (args: { where: { id: number }; select: { role: true } }) => Promise<{ role: Role } | null>
  }
}

export interface AdminAuditDb {
  adminAuditEvent: {
    create: (args: {
      data: {
        actingAdminUserId: number
        actionType: 'ENTITLEMENT_GRANT'
        targetUserId: number
        previousTier: EntitlementTier | null
        newTier: EntitlementTier | null
        entitlementSource: EntitlementSource | null
        correlationId: string | null
      }
    }) => Promise<unknown>
  }
}

export interface BootstrapDb {
  user: {
    findUnique: (args: { where: { email: string }; select: { id: true; role: true } }) => Promise<{ id: number; role: Role } | null>
    update: (args: { where: { id: number }; data: { role: Role } }) => Promise<unknown>
  }
}
