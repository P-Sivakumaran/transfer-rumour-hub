import { PrismaClient } from '@prisma/client'
import type { WatchlistPlayer } from '@prisma/client'
import { checkEntitlement } from '../entitlements/resolver.js'
import { FREE_WATCHLIST_LIMIT } from '../entitlements/flags.js'
import { canAddToFreeWatchlist } from '../entitlements/watchlistLimit.js'
import type { EntitlementTier } from '../entitlements/flags.js'

const prisma = new PrismaClient()

// Advisory-lock namespace for pg_advisory_xact_lock's (int4, int4) form —
// scopes this lock to watchlist-cap enforcement specifically, so it can
// never collide with any other advisory lock added elsewhere later. This
// is the first $transaction / advisory-lock usage in this codebase — see
// docs/public-beta-readiness-audit.md §3 and docs/monetisation-proposal.md
// "Limitations" (the TOCTOU gap this replaces).
const WATCHLIST_LOCK_NAMESPACE = 7301

export async function listWatchlist(userId: number) {
  return prisma.watchlistPlayer.findMany({
    where: { userId },
    include: { player: { include: { currentClub: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export type AddToWatchlistResult =
  | { ok: true; item: WatchlistPlayer; tier: EntitlementTier; wasCreated: boolean }
  | { ok: false; reason: 'WATCHLIST_LIMIT_REACHED'; limit: number }

// Atomic count-check-then-insert for the free-tier cap. The previous
// implementation (count in the controller, then a separate upsert call)
// had a TOCTOU window: two concurrent requests from the same Free user
// could both read "4 watched, under the cap" and both insert, landing at
// 6. Closed here by taking a Postgres advisory transaction lock scoped to
// (namespace, userId) before reading the count — a second concurrent call
// for the *same* user blocks until the first transaction commits or rolls
// back (the lock releases automatically either way, no separate unlock
// call needed); concurrent calls for *different* users never contend,
// since the lock key includes userId.
export async function addToWatchlist(userId: number, playerId: number): Promise<AddToWatchlistResult> {
  return prisma.$transaction(async (tx) => {
    // Explicit ::int4 casts — Prisma parameterizes bare numeric template
    // values as bigint, but the two-argument overload of
    // pg_advisory_xact_lock takes (int4, int4), not (bigint, bigint);
    // without the cast Postgres can't find a matching overload at all.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WATCHLIST_LOCK_NAMESPACE}::int4, ${userId}::int4)`

    const user = await tx.user.findUnique({ where: { id: userId }, select: { tier: true } })
    const tier = (user?.tier ?? 'FREE') as EntitlementTier
    const unlimited = checkEntitlement(tier, 'UNLIMITED_WATCHLIST').allowed

    // Looked up regardless of tier — the free-tier cap check needs it, and
    // the caller needs to know whether this is a genuine first-time add or
    // a no-op re-add (upsert alone can't distinguish the two: it returns a
    // row either way, and WatchlistPlayer has no updatedAt to diff against).
    // Without this, the controller was logging WATCHLIST_CREATED on every
    // duplicate POST, inflating that product metric.
    const existing = await tx.watchlistPlayer.findUnique({ where: { userId_playerId: { userId, playerId } } })

    if (!unlimited) {
      const count = await tx.watchlistPlayer.count({ where: { userId } })
      if (!canAddToFreeWatchlist(count, existing !== null)) {
        return { ok: false, reason: 'WATCHLIST_LIMIT_REACHED', limit: FREE_WATCHLIST_LIMIT }
      }
    }

    const item = await tx.watchlistPlayer.upsert({
      where: { userId_playerId: { userId, playerId } },
      create: { userId, playerId },
      update: {},
    })
    return { ok: true, item, tier, wasCreated: existing === null }
  })
}

export async function removeFromWatchlist(userId: number, playerId: number): Promise<void> {
  await prisma.watchlistPlayer.deleteMany({ where: { userId, playerId } })
}

export async function getWatchlistPlayerIds(userId: number): Promise<number[]> {
  const rows = await prisma.watchlistPlayer.findMany({ where: { userId }, select: { playerId: true } })
  return rows.map((r) => r.playerId)
}

export async function setAlertMode(userId: number, playerId: number, alertMode: 'DELAYED' | 'INSTANT') {
  return prisma.watchlistPlayer.update({ where: { userId_playerId: { userId, playerId } }, data: { alertMode } })
}
