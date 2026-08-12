import { PrismaClient, type Prisma, RumourStatus } from '@prisma/client'

const prisma = new PrismaClient()

export const rumourInclude = {
  player: { include: { currentClub: true } },
  fromClub: true,
  toClub: true,
  source: true,
} satisfies Prisma.RumourInclude

export type RumourWithRelations = Prisma.RumourGetPayload<{ include: typeof rumourInclude }>

export interface RumourFilters {
  league?: string
  clubId?: number
  position?: string
  status?: RumourStatus
  window?: string
  page?: number
  limit?: number
  playerIds?: number[]
}

export async function listRumours(filters: RumourFilters): Promise<{
  data: RumourWithRelations[]
  total: number
  page: number
  limit: number
}> {
  const page = filters.page ?? 1
  const limit = Math.min(filters.limit ?? 20, 100)
  const skip = (page - 1) * limit

  const where: Prisma.RumourWhereInput = {}

  if (filters.status) where.status = filters.status
  if (filters.window) where.window = filters.window as any
  if (filters.clubId) {
    where.OR = [{ fromClubId: filters.clubId }, { toClubId: filters.clubId }]
  }
  if (filters.league) {
    where.OR = [
      { fromClub: { league: { contains: filters.league, mode: 'insensitive' } } },
      { toClub: { league: { contains: filters.league, mode: 'insensitive' } } },
    ]
  }
  if (filters.position) {
    where.player = { position: filters.position as any }
  }
  if (filters.playerIds) {
    where.playerId = { in: filters.playerIds }
  }

  const [data, total] = await Promise.all([
    prisma.rumour.findMany({
      where,
      include: rumourInclude,
      orderBy: { computedLikelihood: 'desc' },
      skip,
      take: limit,
    }),
    prisma.rumour.count({ where }),
  ])

  return { data, total, page, limit }
}

export async function getRumourById(id: number): Promise<RumourWithRelations | null> {
  return prisma.rumour.findUnique({ where: { id }, include: rumourInclude })
}

export async function getRumourHistory(
  id: number,
): Promise<{ computedLikelihood: number; recordedAt: Date }[]> {
  return prisma.rumourHistory.findMany({
    where: { rumourId: id },
    orderBy: { recordedAt: 'asc' },
    select: { computedLikelihood: true, recordedAt: true },
  })
}

// The raw articles that produced or corroborated this rumour — surfaced so a
// status (PENDING/COMPLETED/...) is always traceable back to source text,
// not a bare number or an unaccountable manual click.
export async function getRumourEvidence(id: number): Promise<
  { sourceName: string; headline: string; link: string; publishedAt: Date }[]
> {
  return prisma.rawSignal.findMany({
    where: { rumourId: id },
    orderBy: { publishedAt: 'desc' },
    select: { sourceName: true, headline: true, link: true, publishedAt: true },
  })
}
