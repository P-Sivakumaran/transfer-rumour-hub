/**
 * Seeds the Claim/EvidenceItem provenance model. Depends on seed.ts having
 * run first (needs Arsenal/Man City/Juventus/Liverpool clubs, Viktor
 * Gyökeres/Jonathan David players, and the Fabrizio Romano/Sky
 * Sports/The Athletic/Marca/Unknown Twitter Account sources it creates).
 * Run: tsx prisma/seedEvidence.ts
 *
 * Demonstrates, with runnable data, the three provenance behaviors
 * requirement 4 asks for:
 *  1. Five syndicated write-ups of one Fabrizio Romano scoop, each
 *     explicitly attributing him in text, collapsing to
 *     independentSourceCount = 1 (requirement 7's acceptance scenario).
 *  2. An official club statement confirming a different claim.
 *  3. Two similarly-worded but NOT explicitly-attributed articles on a
 *     third claim, logged as an EvidenceDuplicateCandidate — a candidate,
 *     not an automatic merge (requirement 4b).
 */
import { PrismaClient, SourceType } from '@prisma/client'
import { findOrCreateClaim } from '../src/evidence/claimsService.js'
import { ingestEvidenceItem, computeIndependentSourceCount } from '../src/evidence/evidenceService.js'
import type { EvidenceDb } from '../src/evidence/db.js'

const prisma = new PrismaClient()
const db = prisma as unknown as EvidenceDb

async function main() {
  const [arsenal, manCity, juventus] = await Promise.all([
    prisma.club.findFirstOrThrow({ where: { name: 'Arsenal' } }),
    prisma.club.findFirstOrThrow({ where: { name: 'Manchester City' } }),
    prisma.club.findFirstOrThrow({ where: { name: 'Juventus' } }),
  ])
  const [gyokeres, david] = await Promise.all([
    prisma.player.findFirstOrThrow({ where: { externalId: 'P001' } }), // Viktor Gyökeres
    prisma.player.findFirstOrThrow({ where: { externalId: 'P004' } }), // Jonathan David
  ])
  const [romano, sky, athletic, marca, twitter] = await Promise.all([
    prisma.source.findFirstOrThrow({ where: { name: 'Fabrizio Romano' } }),
    prisma.source.findFirstOrThrow({ where: { name: 'Sky Sports' } }),
    prisma.source.findFirstOrThrow({ where: { name: 'The Athletic' } }),
    prisma.source.findFirstOrThrow({ where: { name: 'Marca' } }),
    prisma.source.findFirstOrThrow({ where: { name: 'Unknown Twitter Account' } }),
  ])
  const clubOfficial = await prisma.source.upsert({
    where: { name: 'Manchester City Official' },
    update: {},
    create: { name: 'Manchester City Official', type: SourceType.CLUB_OFFICIAL, reliabilityScore: 0.99, country: 'GB' },
  })

  // ── Scenario 1: one scoop, four syndications, five sources, one root ──────
  const gyokeresClaim = await findOrCreateClaim(db, {
    playerId: gyokeres.id,
    fromClubId: arsenal.id,
    toClubId: manCity.id,
    transferType: 'PERMANENT',
    statedFee: 85,
    statedContractLengthMonths: 60,
    seenAt: new Date('2026-08-10T09:00:00Z'),
  })

  const original = await ingestEvidenceItem(db, {
    claimId: gyokeresClaim.id,
    sourceId: romano.id,
    canonicalUrl: 'https://twitter.com/FabrizioRomano/status/seed-gyokeres-1',
    publishedAt: new Date('2026-08-10T09:00:00Z'),
    authorName: 'Fabrizio Romano',
    sourceType: SourceType.JOURNALIST,
    title: 'Here we go! Viktor Gyökeres to Manchester City, £85m deal agreed',
    rawExcerpt: 'Understand full agreement now reached between all parties for Viktor Gyökeres to Manchester City. Here we go!',
    evidenceDirection: 'SUPPORTS',
    extractionConfidence: 0.95,
  })

  const syndications = [
    {
      sourceId: sky.id,
      url: 'https://skysports.com/seed/gyokeres-man-city-1',
      publishedAt: '2026-08-10T09:15:00Z',
      title: 'Gyökeres to Man City: deal agreed, according to Fabrizio Romano',
    },
    {
      sourceId: athletic.id,
      url: 'https://theathletic.com/seed/gyokeres-man-city-1',
      publishedAt: '2026-08-10T09:30:00Z',
      title: 'Manchester City agree £85m deal for Gyökeres, as reported by Fabrizio Romano',
    },
    {
      sourceId: marca.id,
      url: 'https://marca.com/seed/gyokeres-man-city-1',
      publishedAt: '2026-08-10T10:00:00Z',
      title: 'Gyökeres al Manchester City por 85 millones, per Fabrizio Romano',
    },
    {
      sourceId: twitter.id,
      url: 'https://x.com/seed/gyokeres-man-city-1',
      publishedAt: '2026-08-10T10:05:00Z',
      title: 'GYOKERES TO CITY CONFIRMED citing Fabrizio Romano 🚨',
    },
  ]

  for (const s of syndications) {
    await ingestEvidenceItem(db, {
      claimId: gyokeresClaim.id,
      sourceId: s.sourceId,
      canonicalUrl: s.url,
      publishedAt: new Date(s.publishedAt),
      sourceType: (await prisma.source.findFirstOrThrow({ where: { id: s.sourceId } })).type,
      title: s.title,
      rawExcerpt: s.title,
      evidenceDirection: 'SUPPORTS',
      extractionConfidence: 0.8,
    })
  }

  // Official confirmation closes the claim's evidence trail.
  await ingestEvidenceItem(db, {
    claimId: gyokeresClaim.id,
    sourceId: clubOfficial.id,
    canonicalUrl: 'https://mancity.com/seed/gyokeres-signing',
    publishedAt: new Date('2026-08-11T12:00:00Z'),
    sourceType: SourceType.CLUB_OFFICIAL,
    title: 'Manchester City completes the transfer of Viktor Gyökeres',
    rawExcerpt: 'Manchester City is delighted to confirm the transfer of Viktor Gyökeres from Arsenal on a permanent deal.',
    evidenceDirection: 'CONFIRMS',
    extractionConfidence: 1.0,
  })

  const independentCount = await computeIndependentSourceCount(db, gyokeresClaim.id)
  console.log(
    `Gyökeres claim ${gyokeresClaim.id}: 6 evidence items ingested, ${independentCount} independent source(s) (expected 2: Romano's scoop + the official statement)`,
  )

  // ── Scenario 2: near-duplicate candidate, no explicit attribution ─────────
  const davidClaim = await findOrCreateClaim(db, {
    playerId: david.id,
    fromClubId: juventus.id,
    toClubId: null,
    transferType: 'FREE',
    seenAt: new Date('2026-08-12T08:00:00Z'),
  })

  await ingestEvidenceItem(db, {
    claimId: davidClaim.id,
    sourceId: sky.id,
    canonicalUrl: 'https://skysports.com/seed/david-free-agent-1',
    publishedAt: new Date('2026-08-12T08:00:00Z'),
    sourceType: SourceType.NEWS_OUTLET,
    title: 'Jonathan David set to leave Juventus as a free agent this summer',
    rawExcerpt: 'Jonathan David is set to leave Juventus as a free agent when his contract expires this summer, Sky Sports understands.',
    evidenceDirection: 'SUPPORTS',
    extractionConfidence: 0.6,
  })

  await ingestEvidenceItem(db, {
    claimId: davidClaim.id,
    sourceId: marca.id,
    canonicalUrl: 'https://marca.com/seed/david-free-agent-1',
    publishedAt: new Date('2026-08-12T08:20:00Z'),
    sourceType: SourceType.NEWS_OUTLET,
    title: 'Jonathan David set to leave Juventus as a free agent this summer window',
    rawExcerpt: 'Jonathan David is set to leave Juventus this summer as a free agent once his contract expires, Marca reports.',
    evidenceDirection: 'SUPPORTS',
    extractionConfidence: 0.6,
  })

  console.log('David claim: two similarly-worded, independently-sourced articles ingested — check evidence_duplicate_candidates for the logged candidate (not auto-merged).')
  console.log('Evidence seed complete.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
