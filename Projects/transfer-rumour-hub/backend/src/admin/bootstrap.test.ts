import { describe, it, expect, vi, afterEach } from 'vitest'
import { bootstrapAdminFromEnv } from './bootstrap.js'
import type { BootstrapDb, Role } from './db.js'

function fakeDb(users: { id: number; email: string; role: Role }[]) {
  const rows = users
  const update = vi.fn(async ({ where, data }: { where: { id: number }; data: { role: Role } }) => {
    const row = rows.find((r) => r.id === where.id)!
    row.role = data.role
    return row
  })
  const db: BootstrapDb = {
    user: {
      findUnique: async ({ where }) => {
        const row = rows.find((r) => r.email === where.email)
        return row ? { id: row.id, role: row.role } : null
      },
      update,
    },
  }
  return { db, update, rows }
}

describe('bootstrapAdminFromEnv', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('does nothing when BOOTSTRAP_ADMIN_EMAIL is not set', async () => {
    delete process.env.BOOTSTRAP_ADMIN_EMAIL
    const { db, update } = fakeDb([{ id: 1, email: 'a@test.com', role: 'USER' }])
    await bootstrapAdminFromEnv(db)
    expect(update).not.toHaveBeenCalled()
  })

  it('promotes an existing matching user to ADMIN', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'a@test.com'
    const { db, rows } = fakeDb([{ id: 1, email: 'a@test.com', role: 'USER' }])
    await bootstrapAdminFromEnv(db)
    expect(rows[0].role).toBe('ADMIN')
  })

  it('is idempotent — does not re-write an already-ADMIN user', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'a@test.com'
    const { db, update } = fakeDb([{ id: 1, email: 'a@test.com', role: 'ADMIN' }])
    await bootstrapAdminFromEnv(db)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not throw when the configured email has no matching user yet (register-then-restart ordering)', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'nobody@test.com'
    const { db, update } = fakeDb([])
    await expect(bootstrapAdminFromEnv(db)).resolves.toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })
})
