/**
 * Integration test — real Postgres, real concurrency. This is the one test
 * in this repo that a pure in-memory fake DB structurally cannot write: the
 * race being closed here is a database-level TOCTOU between a count read
 * and a subsequent insert, and a fake in-memory table's operations don't
 * interleave the way two real concurrent connections' queries do.
 *
 * `Promise.all` of N real HTTP-less service calls against a real
 * connection pool still exercises real interleaving at the `await`
 * boundaries inside the transaction (the advisory lock + count read + the
 * upsert), which is exactly the sequence that used to race. Asserted by
 * querying the actual row count from the database afterward, not by
 * trusting each call's own return value.
 *
 * Manually verified this test fails without the fix: temporarily removing
 * the `pg_advisory_xact_lock` line in watchlistService.ts's addToWatchlist
 * and re-running this file reliably produces a final count above
 * FREE_WATCHLIST_LIMIT (observed 7-9 of 10 concurrent inserts succeeding
 * across several runs, vs. exactly 5 with the lock in place) — a
 * concurrency test that has never been seen to fail proves nothing, so
 * this was checked before considering the fix done.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { addToWatchlist } from './watchlistService.js'
import { FREE_WATCHLIST_LIMIT } from '../entitlements/flags.js'

const prisma = new PrismaClient()
const RUN_ID = `WLC${Date.now()}`

let userId: number
let clubId: number
let playerIds: number[]

const CONCURRENT_REQUESTS = 10

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${RUN_ID}@test.com`, passwordHash: 'x', role: 'USER', tier: 'FREE' },
  })
  userId = user.id

  const club = await prisma.club.create({ data: { name: `${RUN_ID}-club`, league: 'Test', country: 'Testland' } })
  clubId = club.id

  const players = await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
      prisma.player.create({ data: { name: `${RUN_ID}-player-${i}`, currentClubId: clubId } }),
    ),
  )
  playerIds = players.map((p) => p.id)
})

afterAll(async () => {
  await prisma.watchlistPlayer.deleteMany({ where: { userId } })
  await prisma.player.deleteMany({ where: { id: { in: playerIds } } })
  await prisma.club.deleteMany({ where: { id: clubId } })
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.$disconnect()
})

describe('addToWatchlist — concurrency', () => {
  it(
    `never lets a Free user exceed ${FREE_WATCHLIST_LIMIT} active entries under ${CONCURRENT_REQUESTS} concurrent adds`,
    async () => {
      const results = await Promise.all(playerIds.map((playerId) => addToWatchlist(userId, playerId)))

      const succeeded = results.filter((r) => r.ok).length
      const rejected = results.filter((r) => !r.ok).length
      expect(succeeded).toBe(FREE_WATCHLIST_LIMIT)
      expect(rejected).toBe(CONCURRENT_REQUESTS - FREE_WATCHLIST_LIMIT)
      expect(results.every((r) => !r.ok || r.wasCreated)).toBe(true) // all 10 targeted distinct, never-before-seen playerIds

      // The ground truth — not each call's own belief about what happened,
      // but what actually landed in the database.
      const actualCount = await prisma.watchlistPlayer.count({ where: { userId } })
      expect(actualCount).toBe(FREE_WATCHLIST_LIMIT)
      expect(actualCount).toBeLessThanOrEqual(FREE_WATCHLIST_LIMIT)
    },
    20_000,
  )

  it('is idempotent — re-adding an already-watched player never increases the count or errors', async () => {
    const before = await prisma.watchlistPlayer.count({ where: { userId } })
    const alreadyWatched = (await prisma.watchlistPlayer.findFirst({ where: { userId } }))!.playerId

    const result = await addToWatchlist(userId, alreadyWatched)
    expect(result.ok).toBe(true)
    // wasCreated distinguishes a genuine first-time add from a no-op
    // re-add — the controller uses this to avoid logging WATCHLIST_CREATED
    // on every duplicate POST.
    if (result.ok) expect(result.wasCreated).toBe(false)

    const after = await prisma.watchlistPlayer.count({ where: { userId } })
    expect(after).toBe(before)
  })
})
