/**
 * Seeds additional players + clubs currently in real transfer news.
 * Run: tsx prisma/seedExtra.ts
 */
import { PrismaClient, Position } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Additional clubs
  const extraClubs = [
    { externalId: 'TOT', name: 'Tottenham Hotspur', shortName: 'Spurs', league: 'Premier League', country: 'England' },
    { externalId: 'ATM', name: 'Atletico Madrid', shortName: 'Atletico', league: 'La Liga', country: 'Spain' },
    { externalId: 'LIV', name: 'Liverpool', shortName: 'Liverpool', league: 'Premier League', country: 'England' },
    { externalId: 'MUN', name: 'Manchester United', shortName: 'Man Utd', league: 'Premier League', country: 'England' },
    { externalId: 'NEW', name: 'Newcastle United', shortName: 'Newcastle', league: 'Premier League', country: 'England' },
    { externalId: 'INT', name: 'Inter Milan', shortName: 'Inter', league: 'Serie A', country: 'Italy' },
    { externalId: 'ACM', name: 'AC Milan', shortName: 'AC Milan', league: 'Serie A', country: 'Italy' },
    { externalId: 'SPO', name: 'Sporting CP', shortName: 'Sporting', league: 'Primeira Liga', country: 'Portugal' },
    { externalId: 'BVB', name: 'Borussia Dortmund', shortName: 'Dortmund', league: 'Bundesliga', country: 'Germany' },
    { externalId: 'LEI', name: 'Bayer Leverkusen', shortName: 'Leverkusen', league: 'Bundesliga', country: 'Germany' },
    { externalId: 'NAP', name: 'Napoli', shortName: 'Napoli', league: 'Serie A', country: 'Italy' },
    { externalId: 'AST', name: 'Aston Villa', shortName: 'Aston Villa', league: 'Premier League', country: 'England' },
  ]

  const clubs: Record<string, number> = {}
  for (const c of extraClubs) {
    const club = await prisma.club.upsert({
      where: { externalId: c.externalId },
      update: {},
      create: c,
    })
    clubs[c.externalId] = club.id
  }

  // Get existing club IDs
  const existing = await prisma.club.findMany({ select: { id: true, externalId: true } })
  for (const c of existing) if (c.externalId) clubs[c.externalId] = c.id

  // Players currently in real transfer headlines (Aug 2026)
  const players = [
    { externalId: 'P010', name: 'Enzo Fernández', age: 23, position: Position.CM, clubExt: 'CHE', contractEnd: '2029-06-30', marketValue: 80, nationality: 'Argentina' },
    { externalId: 'P011', name: 'Cristian Romero', age: 26, position: Position.CB, clubExt: 'TOT', contractEnd: '2027-06-30', marketValue: 65, nationality: 'Argentina' },
    { externalId: 'P012', name: 'Jack Grealish', age: 30, position: Position.LW, clubExt: 'MCI', contractEnd: '2027-06-30', marketValue: 45, nationality: 'England' },
    { externalId: 'P013', name: 'Rodri', age: 28, position: Position.CDM, clubExt: 'MCI', contractEnd: '2027-06-30', marketValue: 120, nationality: 'Spain' },
    { externalId: 'P014', name: 'Mohamed Salah', age: 34, position: Position.RW, clubExt: 'LIV', contractEnd: '2026-06-30', marketValue: 45, nationality: 'Egypt' },
    { externalId: 'P015', name: 'Victor Osimhen', age: 25, position: Position.ST, clubExt: 'NAP', contractEnd: '2026-06-30', marketValue: 85, nationality: 'Nigeria' },
    { externalId: 'P016', name: 'Cody Gakpo', age: 25, position: Position.LW, clubExt: 'LIV', contractEnd: '2028-06-30', marketValue: 55, nationality: 'Netherlands' },
    { externalId: 'P017', name: 'Miguel Guimarães', age: 26, position: Position.CM, clubExt: 'NEW', contractEnd: '2028-06-30', marketValue: 70, nationality: 'Brazil' },
    { externalId: 'P018', name: 'Bryan Mbeumo', age: 25, position: Position.RW, clubExt: 'TOT', contractEnd: '2027-06-30', marketValue: 60, nationality: 'Cameroon' },
    { externalId: 'P019', name: 'Vinicius Junior', age: 24, position: Position.LW, clubExt: 'RMA', contractEnd: '2027-06-30', marketValue: 180, nationality: 'Brazil' },
    { externalId: 'P020', name: 'Karim Adeyemi', age: 22, position: Position.LW, clubExt: 'BVB', contractEnd: '2027-06-30', marketValue: 55, nationality: 'Germany' },
    { externalId: 'P021', name: 'Ivan Toney', age: 28, position: Position.ST, clubExt: 'TOT', contractEnd: '2027-06-30', marketValue: 40, nationality: 'England' },
  ]

  const clubExtToId: Record<string, number | undefined> = {
    CHE: clubs['CHE'] ?? (await prisma.club.findFirst({ where: { name: 'Chelsea' } }))?.id,
    TOT: clubs['TOT'],
    MCI: (await prisma.club.findFirst({ where: { name: 'Manchester City' } }))?.id,
    LIV: clubs['LIV'],
    NAP: clubs['NAP'],
    NEW: clubs['NEW'],
    BVB: clubs['BVB'],
    RMA: (await prisma.club.findFirst({ where: { name: 'Real Madrid' } }))?.id,
  }

  for (const p of players) {
    const currentClubId = clubExtToId[p.clubExt]
    await prisma.player.upsert({
      where: { externalId: p.externalId },
      update: {},
      create: {
        externalId: p.externalId,
        name: p.name,
        age: p.age,
        position: p.position,
        currentClubId: currentClubId ?? null,
        contractEnd: new Date(p.contractEnd),
        marketValue: p.marketValue,
        nationality: p.nationality,
      },
    })
    console.log(`Seeded: ${p.name}`)
  }
  console.log('Extra seed complete.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
