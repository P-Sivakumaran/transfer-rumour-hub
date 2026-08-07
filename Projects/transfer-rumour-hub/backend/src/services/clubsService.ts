import { PrismaClient, RumourStatus } from '@prisma/client'
import { rumourInclude } from './rumoursService.js'

const prisma = new PrismaClient()

export async function getClubById(id: number) {
  const club = await prisma.club.findUnique({
    where: { id },
    include: {
      players: true,
      rumoursFrom: { include: rumourInclude, orderBy: { computedLikelihood: 'desc' } },
      rumoursTo: { include: rumourInclude, orderBy: { computedLikelihood: 'desc' } },
    },
  })

  if (!club) return null

  const activeStatuses: RumourStatus[] = [RumourStatus.PENDING, RumourStatus.HOT]
  const activeOut = club.rumoursFrom.filter((r) => activeStatuses.includes(r.status))
  const activeIn = club.rumoursTo.filter((r) => activeStatuses.includes(r.status))

  const totalExpectedSpend = activeIn.reduce((sum, r) => {
    const midFee = r.reportedFeeMax != null ? (r.reportedFeeMin ?? 0 + r.reportedFeeMax) / 2 : 0
    return sum + midFee * (r.computedLikelihood / 100)
  }, 0)

  return { ...club, activeOut, activeIn, totalExpectedSpend: Math.round(totalExpectedSpend) }
}

export async function listClubs(league?: string) {
  return prisma.club.findMany({
    where: league ? { league: { contains: league, mode: 'insensitive' } } : undefined,
    orderBy: { name: 'asc' },
  })
}
