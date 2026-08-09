import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function listWatchlist(userId: number) {
  return prisma.watchlistPlayer.findMany({
    where: { userId },
    include: { player: { include: { currentClub: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function addToWatchlist(userId: number, playerId: number) {
  return prisma.watchlistPlayer.upsert({
    where: { userId_playerId: { userId, playerId } },
    create: { userId, playerId },
    update: {},
  })
}

export async function removeFromWatchlist(userId: number, playerId: number): Promise<void> {
  await prisma.watchlistPlayer.deleteMany({ where: { userId, playerId } })
}

export async function getWatchlistPlayerIds(userId: number): Promise<number[]> {
  const rows = await prisma.watchlistPlayer.findMany({ where: { userId }, select: { playerId: true } })
  return rows.map((r) => r.playerId)
}
