import { describe, it, expect, vi, afterEach } from 'vitest'
import { purgeOldProductEvents, runRetentionPurge } from './retention.js'

describe('purgeOldProductEvents', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('deletes rows older than 90 days relative to the given now (default retention)', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 })
    const db = { productEvent: { deleteMany } }
    const now = new Date('2026-08-14T00:00:00Z')

    const count = await purgeOldProductEvents(db, now)

    expect(count).toBe(3)
    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date
    expect(cutoff.toISOString()).toBe('2026-05-16T00:00:00.000Z')
  })

  it('respects a configured PRODUCT_EVENT_RETENTION_DAYS override', async () => {
    process.env.PRODUCT_EVENT_RETENTION_DAYS = '30'
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = { productEvent: { deleteMany } }
    const now = new Date('2026-08-14T00:00:00Z')

    await purgeOldProductEvents(db, now)

    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date
    expect(cutoff.toISOString()).toBe('2026-07-15T00:00:00.000Z')
  })

  it('falls back to the default when the env var is invalid (non-numeric or <= 0)', async () => {
    process.env.PRODUCT_EVENT_RETENTION_DAYS = 'not-a-number'
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 })
    const db = { productEvent: { deleteMany } }
    const now = new Date('2026-08-14T00:00:00Z')

    await purgeOldProductEvents(db, now)

    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date
    expect(cutoff.toISOString()).toBe('2026-05-16T00:00:00.000Z')
  })
})

describe('runRetentionPurge', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  function fakeDb(deleteCount: number) {
    const upsert = vi.fn().mockResolvedValue({})
    return {
      db: {
        productEvent: { deleteMany: vi.fn().mockResolvedValue({ count: deleteCount }) },
        purgeHealth: { upsert },
      },
      upsert,
    }
  }

  it('records a successful run in PurgeHealth with the deleted count and cutoff', async () => {
    const { db, upsert } = fakeDb(5)
    const now = new Date('2026-08-14T00:00:00Z')

    const result = await runRetentionPurge(db, now)

    expect(result.succeeded).toBe(true)
    expect(result.deletedCount).toBe(5)
    expect(upsert).toHaveBeenCalledTimes(1)
    const written = upsert.mock.calls[0][0].update
    expect(written.lastRunSucceeded).toBe(true)
    expect(written.lastDeletedCount).toBe(5)
    expect(written.lastError).toBeNull()
  })

  it('records a failed run in PurgeHealth rather than throwing, and returns succeeded: false', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const db = {
      productEvent: { deleteMany: vi.fn().mockRejectedValue(new Error('connection reset')) },
      purgeHealth: { upsert },
    }

    const result = await runRetentionPurge(db)

    expect(result.succeeded).toBe(false)
    expect(result.error).toBe('connection reset')
    const written = upsert.mock.calls[0][0].update
    expect(written.lastRunSucceeded).toBe(false)
    expect(written.lastError).toBe('connection reset')
  })

  it('is idempotent — running twice against the same already-purged data deletes nothing the second time', async () => {
    let remaining = 3
    const upsert = vi.fn().mockResolvedValue({})
    const db = {
      productEvent: {
        deleteMany: vi.fn().mockImplementation(async () => {
          const count = remaining
          remaining = 0
          return { count }
        }),
      },
      purgeHealth: { upsert },
    }

    const first = await runRetentionPurge(db)
    const second = await runRetentionPurge(db)

    expect(first.deletedCount).toBe(3)
    expect(second.deletedCount).toBe(0)
    expect(second.succeeded).toBe(true)
  })
})
