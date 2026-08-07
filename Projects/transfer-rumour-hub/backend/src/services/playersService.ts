import { PrismaClient } from '@prisma/client'
import { rumourInclude } from './rumoursService.js'

const prisma = new PrismaClient()

export async function getPlayerById(id: number) {
  return prisma.player.findUnique({
    where: { id },
    include: {
      currentClub: true,
      rumours: {
        include: rumourInclude,
        orderBy: { rumourDate: 'desc' },
      },
    },
  })
}

export async function searchPlayers(query: string) {
  return prisma.player.findMany({
    where: { name: { contains: query, mode: 'insensitive' } },
    include: { currentClub: true },
    take: 20,
  })
}
