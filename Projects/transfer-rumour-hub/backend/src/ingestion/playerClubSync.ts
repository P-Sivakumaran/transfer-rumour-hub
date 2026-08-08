/**
 * Reconciles Sportmonks squad data into Player/Club rows.
 *
 * Seed data uses a different externalId namespace ('P001', 'MCI', ...) than
 * Sportmonks ('sm-player-*', 'sm-club-*'). A naive externalId-only upsert
 * would create a second row for the same real person/club (e.g. seed's
 * "Viktor Gyökeres" next to a new sm-player-X "Viktor Gyökeres"), splitting
 * rumour history and breaking entityMatcher.ts's dedup assumptions. So the
 * match order is: externalId → exact-name adoption of an unclaimed row →
 * create. Ambiguous name collisions (more than one unclaimed row with the
 * same name) deliberately skip adoption rather than guess — a duplicate row
 * is recoverable, a mis-merge (wrong externalId on the wrong person) quietly
 * corrupts that person's history.
 */
import type { PrismaClient } from '@prisma/client'
import { fetchLeagueCatalog, type NormalizedClub, type NormalizedPlayer } from './sportmonksCatalog.js'
import { invalidateEntityCache } from './entityMatcher.js'

// Minimal slice of PrismaClient this module actually uses — lets tests inject
// an in-memory fake instead of a real database, same style as applyOutcome()
// in outcomeDetector.ts taking `db: PrismaClient` as a parameter.
export interface SyncDb {
  club: {
    findFirst(args: any): Promise<{ id: number } | null>
    findMany(args: any): Promise<{ id: number }[]>
    update(args: any): Promise<unknown>
    create(args: any): Promise<{ id: number }>
  }
  player: {
    findFirst(args: any): Promise<{ id: number } | null>
    findMany(args: any): Promise<{ id: number }[]>
    update(args: any): Promise<unknown>
    create(args: any): Promise<{ id: number }>
  }
}

export async function upsertClub(db: SyncDb, nc: NormalizedClub): Promise<number> {
  const byExternalId = await db.club.findFirst({ where: { externalId: nc.externalId } })
  if (byExternalId) {
    await db.club.update({
      where: { id: byExternalId.id },
      data: { name: nc.name, shortName: nc.shortName, league: nc.league, country: nc.country, logoUrl: nc.logoUrl },
    })
    return byExternalId.id
  }

  // Match by name alone, not `externalId: null` — seed data already has
  // non-null externalIds in its own namespace ('MCI', 'P001', ...), and those
  // rows are exactly the ones that most need adopting, not just auto-created
  // rows that happen to have a null externalId.
  const adoptable = await db.club.findMany({ where: { name: nc.name } })
  if (adoptable.length === 1) {
    await db.club.update({
      where: { id: adoptable[0].id },
      data: {
        externalId: nc.externalId,
        shortName: nc.shortName,
        league: nc.league,
        country: nc.country,
        logoUrl: nc.logoUrl,
      },
    })
    return adoptable[0].id
  }
  if (adoptable.length > 1) {
    console.warn(
      `[playerClubSync] Ambiguous adoption for club "${nc.name}" — ${adoptable.length} unclaimed rows match by name, creating new row instead`,
    )
  }

  const created = await db.club.create({
    data: {
      externalId: nc.externalId,
      name: nc.name,
      shortName: nc.shortName,
      league: nc.league,
      country: nc.country,
      logoUrl: nc.logoUrl,
      autoCreated: false,
    },
  })
  return created.id
}

export async function upsertPlayer(db: SyncDb, np: NormalizedPlayer, currentClubId: number): Promise<number> {
  const byExternalId = await db.player.findFirst({ where: { externalId: np.externalId } })
  if (byExternalId) {
    await db.player.update({
      where: { id: byExternalId.id },
      data: {
        name: np.name,
        age: np.age,
        position: np.position,
        currentClubId,
        nationality: np.nationality,
        photoUrl: np.photoUrl,
      },
    })
    return byExternalId.id
  }

  // See the comment in upsertClub — match by name alone, not `externalId: null`.
  const adoptable = await db.player.findMany({ where: { name: np.name } })
  if (adoptable.length === 1) {
    await db.player.update({
      where: { id: adoptable[0].id },
      data: {
        externalId: np.externalId,
        age: np.age,
        position: np.position,
        currentClubId,
        nationality: np.nationality,
        photoUrl: np.photoUrl,
      },
    })
    return adoptable[0].id
  }
  if (adoptable.length > 1) {
    console.warn(
      `[playerClubSync] Ambiguous adoption for player "${np.name}" — ${adoptable.length} unclaimed rows match by name, creating new row instead`,
    )
  }

  const created = await db.player.create({
    data: {
      externalId: np.externalId,
      name: np.name,
      age: np.age,
      position: np.position,
      currentClubId,
      nationality: np.nationality,
      photoUrl: np.photoUrl,
      autoCreated: false,
    },
  })
  return created.id
}

export async function runPlayerClubSync(db: SyncDb): Promise<{ clubs: number; players: number }> {
  const { clubs, players } = await fetchLeagueCatalog()
  if (!clubs.length) return { clubs: 0, players: 0 }

  const clubIdByExternalId = new Map<string, number>()
  for (const c of clubs) {
    clubIdByExternalId.set(c.externalId, await upsertClub(db, c))
  }

  let playerCount = 0
  for (const p of players) {
    const clubId = clubIdByExternalId.get(p.currentClubExternalId)
    if (!clubId) continue // defensive — should not happen if the catalog fetch is internally consistent
    await upsertPlayer(db, p, clubId)
    playerCount++
  }

  invalidateEntityCache()
  return { clubs: clubs.length, players: playerCount }
}

// Convenience wrapper for callers that already have a real PrismaClient.
export function runPlayerClubSyncWithPrisma(prisma: PrismaClient): Promise<{ clubs: number; players: number }> {
  return runPlayerClubSync(prisma as unknown as SyncDb)
}
