import { describe, it, expect, vi } from 'vitest'
import { recordEntitlementGrant } from './auditService.js'
import type { AdminAuditDb } from './db.js'

describe('recordEntitlementGrant', () => {
  it('writes an audit event with the full before/after tier and no secret material', async () => {
    const create = vi.fn().mockResolvedValue({})
    const db: AdminAuditDb = { adminAuditEvent: { create } }

    await recordEntitlementGrant(db, {
      actingAdminUserId: 1,
      targetUserId: 2,
      previousTier: 'FREE',
      newTier: 'PRO',
      entitlementSource: 'MANUAL',
      correlationId: 'req-123',
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        actingAdminUserId: 1,
        actionType: 'ENTITLEMENT_GRANT',
        targetUserId: 2,
        previousTier: 'FREE',
        newTier: 'PRO',
        entitlementSource: 'MANUAL',
        correlationId: 'req-123',
      },
    })
  })

  it('defaults correlationId to null when not supplied', async () => {
    const create = vi.fn().mockResolvedValue({})
    const db: AdminAuditDb = { adminAuditEvent: { create } }

    await recordEntitlementGrant(db, {
      actingAdminUserId: 1,
      targetUserId: 2,
      previousTier: 'FREE',
      newTier: 'RESEARCH',
      entitlementSource: 'MANUAL',
    })

    expect(create.mock.calls[0][0].data.correlationId).toBeNull()
  })
})
