/**
 * Integration test — the first one in this repo (every other test file uses
 * an in-memory fake DB, e.g. playerClubSync.test.ts's makeFakeTable). Runs
 * against the real DATABASE_URL from .env: exercises the actual migration
 * (unique constraints, FKs, the self-referential provenanceRootId column,
 * the JSONB extractedAttributions column) rather than the fake's plain-object
 * equality matching. Requires a running Postgres with migrations applied
 * (`npm run migrate:deploy`) — same requirement entityMatcher.replay.ts
 * documents for its live-DB replay harness.
 *
 * Creates its own throwaway fixtures (uniquely named per run) and cleans
 * them up in `afterAll`, in FK dependency order. Does not depend on
 * seed.ts/seedExtra.ts/seedEvidence.ts having been run first.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient, SourceType } from '@prisma/client'
import { findOrCreateClaim } from './claimsService.js'
import { ingestEvidenceItem, computeIndependentSourceCount, getClaimProvenance } from './evidenceService.js'
import type { EvidenceDb } from './db.js'

const prisma = new PrismaClient()
const db = prisma as unknown as EvidenceDb

// Must start with an uppercase letter — ATTRIBUTION_PATTERN in provenance.ts
// only captures a cited name starting with [A-Z] ("according to Fabrizio
// Romano" style journalism phrasing), and this run id is embedded directly
// in the "Original" source's name so the attribution test below can cite it
// verbatim.
const RUN_ID = `IT${Date.now()}`

let clubId: number
let playerId: number
let sourceIds: number[]
let claimId: number
let evidenceItemIds: number[] = []

beforeAll(async () => {
  const club = await prisma.club.create({
    data: { name: `${RUN_ID}-club`, league: 'Test League', country: 'Testland' },
  })
  clubId = club.id

  const player = await prisma.player.create({
    data: { externalId: `${RUN_ID}-player`, name: `${RUN_ID} Player`, position: 'ST', currentClubId: clubId },
  })
  playerId = player.id

  const sources = await Promise.all(
    ['Original', 'Syndicate1', 'Syndicate2', 'Syndicate3', 'Syndicate4'].map((label) =>
      prisma.source.create({
        data: { name: `${RUN_ID}-${label}`, type: SourceType.NEWS_OUTLET, reliabilityScore: 0.7 },
      }),
    ),
  )
  sourceIds = sources.map((s) => s.id)
})

afterAll(async () => {
  await prisma.evidenceDuplicateCandidate.deleteMany({ where: { evidenceItem: { claimId } } })
  await prisma.evidenceItem.deleteMany({ where: { id: { in: evidenceItemIds } } })
  await prisma.claim.deleteMany({ where: { id: claimId } })
  await prisma.source.deleteMany({ where: { id: { in: sourceIds } } })
  await prisma.player.delete({ where: { id: playerId } })
  await prisma.club.delete({ where: { id: clubId } })
  await prisma.$disconnect()
})

describe('evidence model — integration (real Postgres)', () => {
  it('persists a Claim and enforces the (canonicalUrl, claimId) unique constraint non-destructively', async () => {
    const claim = await findOrCreateClaim(db, {
      playerId,
      fromClubId: clubId,
      toClubId: null,
      transferType: 'PERMANENT',
      statedFee: 50,
      statedContractLengthMonths: 48,
      seenAt: new Date('2026-01-01T00:00:00Z'),
    })
    claimId = claim.id
    expect(claim.claimStatus).toBe('ACTIVE')

    const first = await ingestEvidenceItem(db, {
      claimId,
      sourceId: sourceIds[0],
      canonicalUrl: `https://example.com/${RUN_ID}/original`,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      sourceType: SourceType.NEWS_OUTLET,
      title: 'Original scoop',
      rawExcerpt: 'The original report.',
      extractionConfidence: 0.9,
    })
    evidenceItemIds.push(first.item.id)
    expect(first.created).toBe(true)

    // Re-ingest same URL+claim — DB-level unique constraint + app-level
    // upsert path must both hold: no duplicate row, original content intact.
    const again = await ingestEvidenceItem(db, {
      claimId,
      sourceId: sourceIds[0],
      canonicalUrl: `https://example.com/${RUN_ID}/original`,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      sourceType: SourceType.NEWS_OUTLET,
      title: 'THIS SHOULD NEVER BE WRITTEN',
      rawExcerpt: 'THIS SHOULD NEVER BE WRITTEN',
      extractionConfidence: 0.9,
    })
    expect(again.created).toBe(false)
    expect(again.item.id).toBe(first.item.id)
    expect(again.item.title).toBe('Original scoop')

    const rowsForUrl = await prisma.evidenceItem.findMany({
      where: { canonicalUrl: `https://example.com/${RUN_ID}/original` },
    })
    expect(rowsForUrl).toHaveLength(1)
  })

  // Requirement 7's named acceptance scenario, run against a real database.
  it('five articles derived from one original report count as one independent source', async () => {
    // Attribution matching is name-based (matchAttributedSource) — the exact
    // Source.name ("<RUN_ID>-Original") must appear verbatim after the
    // attribution phrase for the citation to resolve. Different phrase forms
    // ("according to"/"as reported by"/"per"/"citing") are covered
    // individually by provenance.test.ts's unit tests; this test only needs
    // one working form, applied 4x from 4 distinct sources.
    for (let i = 0; i < 4; i++) {
      const result = await ingestEvidenceItem(db, {
        claimId,
        sourceId: sourceIds[i + 1],
        canonicalUrl: `https://example.com/${RUN_ID}/syndicated-${i}`,
        publishedAt: new Date('2026-01-01T00:30:00Z'),
        sourceType: SourceType.NEWS_OUTLET,
        title: `Syndicated write-up ${i}, according to ${RUN_ID}-Original`,
        rawExcerpt: `Deal confirmed, according to ${RUN_ID}-Original.`,
        extractionConfidence: 0.7,
      })
      evidenceItemIds.push(result.item.id)
    }

    const independentCount = await computeIndependentSourceCount(db, claimId)
    expect(independentCount).toBe(1)

    const provenance = await getClaimProvenance(db, claimId)
    expect(provenance.evidenceCount).toBe(5)
    expect(provenance.independentSourceCount).toBe(1)
    expect(provenance.provenanceClusters).toHaveLength(1)
    expect(provenance.provenanceClusters[0].syndicated).toHaveLength(4)
  })
})
