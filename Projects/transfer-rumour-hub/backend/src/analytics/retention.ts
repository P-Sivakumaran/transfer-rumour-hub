// Retention for ProductEvent rows (docs/monetisation-proposal.md privacy
// section). Wired to a live daily job as of this task — see
// queue/scheduler.ts's 'purge-product-events-recurring' scheduler and
// queue/workers.ts's maintenance worker, which call runRetentionPurge()
// below. See docs/data-retention.md.

const DEFAULT_RETENTION_DAYS = 90

function retentionDays(): number {
  const raw = process.env.PRODUCT_EVENT_RETENTION_DAYS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_RETENTION_DAYS : parsed
}

export interface RetentionDb {
  productEvent: {
    deleteMany: (args: { where: { createdAt: { lt: Date } } }) => Promise<{ count: number }>
  }
}

// Kept as its own small function (pre-existing signature/behavior
// preserved) — deletes rows older than the configured retention window
// (env `PRODUCT_EVENT_RETENTION_DAYS`, default 90) and returns the count.
// Naturally idempotent: re-running with the same or a later `now` only
// ever deletes rows that are still older than the cutoff, so a repeat run
// against already-purged data deletes zero rows rather than erroring or
// double-counting.
export async function purgeOldProductEvents(db: RetentionDb, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays() * 24 * 60 * 60 * 1000)
  const result = await db.productEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return result.count
}

export interface PurgeHealthRow {
  lastRunStartedAt: Date | null
  lastRunCompletedAt: Date | null
  lastRunSucceeded: boolean | null
  lastDeletedCount: number | null
  lastCutoff: Date | null
  lastError: string | null
}

// Single upserted row (id fixed to 1), not an append-only run log — see
// schema.prisma's PurgeHealth comment for why an unbounded history table
// would just recreate the retention problem this whole feature exists to
// close. This is the "basic health-checkable last successful purge
// record" the task asks for, at its cheapest implementable shape.
export interface PurgeHealthDb {
  purgeHealth: {
    upsert: (args: {
      where: { id: 1 }
      create: { id: 1 } & PurgeHealthRow
      update: PurgeHealthRow
    }) => Promise<unknown>
  }
}

export interface PurgeResult {
  startedAt: Date
  completedAt: Date
  deletedCount: number
  cutoff: Date
  succeeded: boolean
  error?: string
}

// The job-facing entry point (queue/workers.ts's maintenance worker calls
// this, not purgeOldProductEvents directly) — records start/completion
// time, deleted count, cutoff, and success/failure to PurgeHealth so
// "did the purge run, and did it work" is a single-row read rather than a
// log to search. A failure here is caught, recorded, and returned rather
// than thrown, so the caller (the BullMQ job handler) can decide whether a
// failed purge should also fail the job (it does — see workers.ts) without
// this function needing to know about jobs/queues at all.
export async function runRetentionPurge(db: RetentionDb & PurgeHealthDb, now: Date = new Date()): Promise<PurgeResult> {
  const startedAt = new Date()
  const cutoff = new Date(now.getTime() - retentionDays() * 24 * 60 * 60 * 1000)

  try {
    const deletedCount = await purgeOldProductEvents(db, now)
    const completedAt = new Date()
    const health: PurgeHealthRow = {
      lastRunStartedAt: startedAt,
      lastRunCompletedAt: completedAt,
      lastRunSucceeded: true,
      lastDeletedCount: deletedCount,
      lastCutoff: cutoff,
      lastError: null,
    }
    await db.purgeHealth.upsert({ where: { id: 1 }, create: { id: 1, ...health }, update: health })
    return { startedAt, completedAt, deletedCount, cutoff, succeeded: true }
  } catch (err) {
    const completedAt = new Date()
    const message = err instanceof Error ? err.message : String(err)
    const health: PurgeHealthRow = {
      lastRunStartedAt: startedAt,
      lastRunCompletedAt: completedAt,
      lastRunSucceeded: false,
      lastDeletedCount: null,
      lastCutoff: cutoff,
      lastError: message,
    }
    // Best-effort — if writing the health record itself also fails, don't
    // let that mask the original purge error from the caller.
    await db.purgeHealth.upsert({ where: { id: 1 }, create: { id: 1, ...health }, update: health }).catch(() => {})
    return { startedAt, completedAt, deletedCount: 0, cutoff, succeeded: false, error: message }
  }
}
