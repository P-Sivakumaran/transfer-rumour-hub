import { describe, it, expect, beforeEach } from 'vitest'
import { upsertClub, upsertPlayer, type SyncDb } from './playerClubSync.js'
import type { NormalizedClub, NormalizedPlayer } from './sportmonksCatalog.js'

// In-memory fake matching the minimal SyncDb slice — no real Prisma/DB
// needed to exercise the externalId → name-adoption → create decision logic.
interface Row {
  id: number
  externalId: string | null
  name: string
  [key: string]: unknown
}

function makeFakeTable(seed: Row[]) {
  const rows = [...seed]
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1

  return {
    rows,
    async findFirst(args: { where: Record<string, unknown> }) {
      return rows.find((r) => Object.entries(args.where).every(([k, v]) => r[k] === v)) ?? null
    },
    async findMany(args: { where: Record<string, unknown> }) {
      return rows.filter((r) => Object.entries(args.where).every(([k, v]) => r[k] === v))
    },
    async update(args: { where: { id: number }; data: Record<string, unknown> }) {
      const row = rows.find((r) => r.id === args.where.id)!
      Object.assign(row, args.data)
      return row
    },
    async create(args: { data: Record<string, unknown> }) {
      const row = { id: nextId++, ...args.data } as Row
      rows.push(row)
      return row
    },
  }
}

function makeFakeDb(clubSeed: Row[], playerSeed: Row[]): { db: SyncDb; club: ReturnType<typeof makeFakeTable>; player: ReturnType<typeof makeFakeTable> } {
  const club = makeFakeTable(clubSeed)
  const player = makeFakeTable(playerSeed)
  return { db: { club, player } as unknown as SyncDb, club, player }
}

const SEED_CLUB: Row = { id: 1, externalId: 'MCI', name: 'Manchester City', shortName: 'Man City', league: 'Premier League', country: 'England' }
const SEED_PLAYER: Row = { id: 1, externalId: 'P001', name: 'Viktor Gyökeres', currentClubId: null }

describe('upsertClub', () => {
  it('adopts an existing unclaimed row by exact name instead of duplicating it', async () => {
    const { db, club } = makeFakeDb([SEED_CLUB], [])
    const incoming: NormalizedClub = {
      externalId: 'sm-club-9',
      name: 'Manchester City',
      shortName: 'Man City',
      league: 'Premier League',
      country: 'England',
      logoUrl: null,
    }

    const id = await upsertClub(db, incoming)

    expect(id).toBe(SEED_CLUB.id)
    expect(club.rows).toHaveLength(1)
    expect(club.rows[0].externalId).toBe('sm-club-9')
  })

  it('adopts across a punctuation mismatch instead of duplicating (regression: real Sportmonks data)', async () => {
    const seedPsg: Row = { id: 1, externalId: 'PSG', name: 'Paris Saint-Germain', shortName: 'PSG', league: 'Ligue 1', country: 'France' }
    const { db, club } = makeFakeDb([seedPsg], [])
    const incoming: NormalizedClub = {
      externalId: 'sm-club-591',
      name: 'Paris Saint Germain', // Sportmonks — no hyphen
      shortName: 'PSG',
      league: 'Champions League',
      country: 'France',
      logoUrl: null,
    }

    const id = await upsertClub(db, incoming)

    expect(id).toBe(seedPsg.id)
    expect(club.rows).toHaveLength(1)
    expect(club.rows[0].externalId).toBe('sm-club-591')
  })

  it('updates in place on a repeat sync (externalId already matches)', async () => {
    const { db, club } = makeFakeDb([{ ...SEED_CLUB, externalId: 'sm-club-9' }], [])
    const incoming: NormalizedClub = {
      externalId: 'sm-club-9',
      name: 'Manchester City',
      shortName: 'Man City',
      league: 'Premier League',
      country: 'England',
      logoUrl: 'https://example.com/logo.png',
    }

    await upsertClub(db, incoming)

    expect(club.rows).toHaveLength(1)
    expect(club.rows[0].logoUrl).toBe('https://example.com/logo.png')
  })

  it('creates a new row for a name with no unclaimed match', async () => {
    const { db, club } = makeFakeDb([SEED_CLUB], [])
    const incoming: NormalizedClub = {
      externalId: 'sm-club-40',
      name: 'Brighton & Hove Albion',
      shortName: 'Brighton',
      league: 'Premier League',
      country: 'England',
      logoUrl: null,
    }

    await upsertClub(db, incoming)

    expect(club.rows).toHaveLength(2)
    const created = club.rows.find((r) => r.externalId === 'sm-club-40')!
    expect(created.autoCreated).toBe(false)
  })

  it('skips adoption and creates a new row when the name is ambiguous', async () => {
    const dup1: Row = { id: 1, externalId: null, name: 'AC Milan', league: 'Unknown', country: 'Unknown' }
    const dup2: Row = { id: 2, externalId: null, name: 'AC Milan', league: 'Unknown', country: 'Unknown' }
    const { db, club } = makeFakeDb([dup1, dup2], [])
    const incoming: NormalizedClub = {
      externalId: 'sm-club-15',
      name: 'AC Milan',
      shortName: 'Milan',
      league: 'Serie A',
      country: 'Italy',
      logoUrl: null,
    }

    await upsertClub(db, incoming)

    expect(club.rows).toHaveLength(3)
    expect(dup1.externalId).toBeNull()
    expect(dup2.externalId).toBeNull()
  })
})

describe('upsertPlayer', () => {
  it('adopts an existing unclaimed row by exact name instead of duplicating it', async () => {
    const { db, player } = makeFakeDb([], [SEED_PLAYER])
    const incoming: NormalizedPlayer = {
      externalId: 'sm-player-501',
      name: 'Viktor Gyökeres',
      currentClubExternalId: 'sm-club-9',
      age: 26,
      position: 'ST',
      nationality: 'Sweden',
      photoUrl: null,
    }

    const id = await upsertPlayer(db, incoming, 42)

    expect(id).toBe(SEED_PLAYER.id)
    expect(player.rows).toHaveLength(1)
    expect(player.rows[0].externalId).toBe('sm-player-501')
    expect(player.rows[0].currentClubId).toBe(42)
  })

  it('creates a new row with autoCreated=false for an unmatched player', async () => {
    const { db, player } = makeFakeDb([], [SEED_PLAYER])
    const incoming: NormalizedPlayer = {
      externalId: 'sm-player-777',
      name: 'Someone New',
      currentClubExternalId: 'sm-club-9',
      age: 22,
      position: 'CM',
      nationality: 'France',
      photoUrl: null,
    }

    await upsertPlayer(db, incoming, 42)

    expect(player.rows).toHaveLength(2)
    const created = player.rows.find((r) => r.externalId === 'sm-player-777')!
    expect(created.autoCreated).toBe(false)
  })
})
