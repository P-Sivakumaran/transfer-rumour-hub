import { PrismaClient, Position, SourceType, TransferWindow, RumourStatus } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Sources
  const sources = await Promise.all([
    prisma.source.upsert({
      where: { name: 'Fabrizio Romano' },
      update: {},
      create: { name: 'Fabrizio Romano', type: SourceType.JOURNALIST, reliabilityScore: 0.92, country: 'IT', url: 'https://twitter.com/FabrizioRomano' },
    }),
    prisma.source.upsert({
      where: { name: 'The Athletic' },
      update: {},
      create: { name: 'The Athletic', type: SourceType.NEWS_OUTLET, reliabilityScore: 0.85, country: 'GB', url: 'https://theathletic.com' },
    }),
    prisma.source.upsert({
      where: { name: 'Sky Sports' },
      update: {},
      create: { name: 'Sky Sports', type: SourceType.NEWS_OUTLET, reliabilityScore: 0.78, country: 'GB', url: 'https://skysports.com' },
    }),
    prisma.source.upsert({
      where: { name: 'Marca' },
      update: {},
      create: { name: 'Marca', type: SourceType.NEWS_OUTLET, reliabilityScore: 0.65, country: 'ES', url: 'https://marca.com' },
    }),
    prisma.source.upsert({
      where: { name: 'Unknown Twitter Account' },
      update: {},
      create: { name: 'Unknown Twitter Account', type: SourceType.SOCIAL_MEDIA, reliabilityScore: 0.20, country: null },
    }),
  ])

  // Clubs
  const clubs = await Promise.all([
    prisma.club.upsert({ where: { externalId: 'MCI' }, update: {}, create: { externalId: 'MCI', name: 'Manchester City', shortName: 'Man City', league: 'Premier League', country: 'England' } }),
    prisma.club.upsert({ where: { externalId: 'RMA' }, update: {}, create: { externalId: 'RMA', name: 'Real Madrid', shortName: 'Real Madrid', league: 'La Liga', country: 'Spain' } }),
    prisma.club.upsert({ where: { externalId: 'FCB' }, update: {}, create: { externalId: 'FCB', name: 'FC Barcelona', shortName: 'Barcelona', league: 'La Liga', country: 'Spain' } }),
    prisma.club.upsert({ where: { externalId: 'BAY' }, update: {}, create: { externalId: 'BAY', name: 'Bayern Munich', shortName: 'Bayern', league: 'Bundesliga', country: 'Germany' } }),
    prisma.club.upsert({ where: { externalId: 'PSG' }, update: {}, create: { externalId: 'PSG', name: 'Paris Saint-Germain', shortName: 'PSG', league: 'Ligue 1', country: 'France' } }),
    prisma.club.upsert({ where: { externalId: 'CHE' }, update: {}, create: { externalId: 'CHE', name: 'Chelsea', shortName: 'Chelsea', league: 'Premier League', country: 'England' } }),
    prisma.club.upsert({ where: { externalId: 'ARS' }, update: {}, create: { externalId: 'ARS', name: 'Arsenal', shortName: 'Arsenal', league: 'Premier League', country: 'England' } }),
    prisma.club.upsert({ where: { externalId: 'JUV' }, update: {}, create: { externalId: 'JUV', name: 'Juventus', shortName: 'Juventus', league: 'Serie A', country: 'Italy' } }),
    prisma.club.upsert({ where: { externalId: 'LIV' }, update: {}, create: { externalId: 'LIV', name: 'Liverpool', shortName: 'Liverpool', league: 'Premier League', country: 'England' } }),
    prisma.club.upsert({ where: { externalId: 'MUN' }, update: {}, create: { externalId: 'MUN', name: 'Manchester United', shortName: 'Man United', league: 'Premier League', country: 'England' } }),
  ])

  const [manCity, realMadrid, barcelona, bayern, psg, chelsea, arsenal, juventus, liverpool, manUnited] = clubs

  // Players
  const now = new Date()
  const players = await Promise.all([
    // Club fields below were corrected 2026-08-09 against live transfer news — the
    // originals were demo placeholders that had drifted from reality (Gyökeres was
    // never at Barcelona; Wirtz/Yoro/David have all since moved on from these clubs).
    prisma.player.upsert({
      where: { externalId: 'P001' }, update: {},
      create: { externalId: 'P001', name: 'Viktor Gyökeres', age: 26, position: Position.ST, currentClubId: arsenal.id, contractEnd: new Date('2028-06-30'), marketValue: 120, nationality: 'Sweden' },
    }),
    prisma.player.upsert({
      where: { externalId: 'P002' }, update: {},
      create: { externalId: 'P002', name: 'Florian Wirtz', age: 21, position: Position.CAM, currentClubId: liverpool.id, contractEnd: new Date('2027-06-30'), marketValue: 130, nationality: 'Germany' },
    }),
    prisma.player.upsert({
      where: { externalId: 'P003' }, update: {},
      create: { externalId: 'P003', name: 'Leny Yoro', age: 18, position: Position.CB, currentClubId: manUnited.id, contractEnd: new Date('2029-06-30'), marketValue: 80, nationality: 'France' },
    }),
    prisma.player.upsert({
      where: { externalId: 'P004' }, update: {},
      create: { externalId: 'P004', name: 'Jonathan David', age: 24, position: Position.ST, currentClubId: juventus.id, contractEnd: new Date('2030-06-30'), marketValue: 65, nationality: 'Canada' },
    }),
  ])

  const [gyokeres, wirtz, yoro, david] = players

  // Rumours with realistic data
  const rumourData = [
    {
      externalId: 'R001',
      playerId: gyokeres.id,
      fromClubId: arsenal.id,
      toClubId: manCity.id,
      sourceId: sources[0].id, // Romano
      reportedFeeMin: 100,
      reportedFeeMax: 120,
      window: TransferWindow.SUMMER,
      baseProbability: 0.65,
      distinctSourceCount: 4,
      status: RumourStatus.HOT,
    },
    {
      externalId: 'R002',
      playerId: wirtz.id,
      fromClubId: liverpool.id,
      toClubId: realMadrid.id,
      sourceId: sources[1].id, // Athletic
      reportedFeeMin: 120,
      reportedFeeMax: 150,
      window: TransferWindow.SUMMER,
      baseProbability: 0.55,
      distinctSourceCount: 3,
      status: RumourStatus.PENDING,
    },
    {
      externalId: 'R003',
      playerId: david.id,
      fromClubId: juventus.id,
      toClubId: psg.id,
      sourceId: sources[2].id, // Sky
      reportedFeeMin: 60,
      reportedFeeMax: 75,
      window: TransferWindow.SUMMER,
      baseProbability: 0.80,
      distinctSourceCount: 5,
      status: RumourStatus.HOT,
    },
    {
      externalId: 'R004',
      playerId: yoro.id,
      fromClubId: manUnited.id,
      toClubId: chelsea.id,
      sourceId: sources[3].id, // Marca
      reportedFeeMin: 70,
      reportedFeeMax: 90,
      window: TransferWindow.SUMMER,
      baseProbability: 0.30,
      distinctSourceCount: 1,
      status: RumourStatus.PENDING,
    },
  ]

  for (const data of rumourData) {
    const rumour = await prisma.rumour.upsert({
      where: { externalId: data.externalId },
      update: {},
      create: {
        ...data,
        computedLikelihood: 0, // will be recomputed by scoring engine
      },
    })
    // Seed some history points (last 10 days)
    for (let i = 9; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const jitter = (Math.random() - 0.5) * 10
      await prisma.rumourHistory.create({
        data: {
          rumourId: rumour.id,
          computedLikelihood: Math.max(0, Math.min(100, data.baseProbability * 100 + jitter)),
          status: data.status,
          recordedAt: date,
        },
      })
    }
  }

  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
