import { describe, it, expect } from 'vitest'
import {
  ingestEvidenceItem,
  computeIndependentSourceCount,
  getClaimProvenance,
  resolveDuplicateCandidate,
} from './evidenceService.js'
import type { EvidenceDb } from './db.js'

// In-memory fake matching the minimal EvidenceDb slice — same style as
// playerClubSync.test.ts's makeFakeTable, no real Prisma/DB needed.
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'not' in (v as object)) {
      return row[k] !== (v as { not: unknown }).not
    }
    return row[k] === v
  })
}

function makeFakeTable(seed: Record<string, unknown>[] = []) {
  const rows = [...seed]
  let nextId = Math.max(0, ...rows.map((r) => r.id as number)) + 1
  return {
    rows,
    async findFirst(args: { where: Record<string, unknown> }) {
      return rows.find((r) => matchesWhere(r, args.where)) ?? null
    },
    async findMany(args: { where?: Record<string, unknown> }) {
      return args?.where ? rows.filter((r) => matchesWhere(r, args.where!)) : rows
    },
    async update(args: { where: { id: number }; data: Record<string, unknown> }) {
      const row = rows.find((r) => r.id === args.where.id)!
      Object.assign(row, args.data)
      return row
    },
    async create(args: { data: Record<string, unknown> }) {
      const row = { id: nextId++, ...args.data }
      rows.push(row)
      return row
    },
    async count(args: { where?: Record<string, unknown> }) {
      return args?.where ? rows.filter((r) => matchesWhere(r, args.where!)).length : rows.length
    },
  }
}

function makeFakeDb(): EvidenceDb {
  const claim = makeFakeTable([{ id: 1, playerId: 1, fromClubId: 10, toClubId: 20, lastEvidenceAt: new Date('2026-01-01') }])
  const evidenceItem = makeFakeTable()
  const evidenceDuplicateCandidate = makeFakeTable()
  const source = makeFakeTable([
    { id: 100, name: 'Fabrizio Romano' },
    { id: 101, name: 'Sky Sports' },
    { id: 102, name: 'The Athletic' },
    { id: 103, name: 'Marca' },
    { id: 104, name: 'Unknown Twitter Account' },
  ])
  return { claim, evidenceItem, evidenceDuplicateCandidate, source } as unknown as EvidenceDb
}

const BASE_ITEM = {
  claimId: 1,
  sourceType: 'JOURNALIST',
  extractionConfidence: 0.9,
}

describe('ingestEvidenceItem — non-destructive dedup (requirement 3, 4a)', () => {
  it('re-ingesting the same (canonicalUrl, claimId) never overwrites the original content', async () => {
    const db = makeFakeDb()
    const first = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 100,
      canonicalUrl: 'https://example.com/a',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Original title',
      rawExcerpt: 'Original excerpt',
    })
    expect(first.created).toBe(true)

    const second = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 100,
      canonicalUrl: 'https://example.com/a',
      publishedAt: new Date('2026-01-02T00:00:00Z'),
      title: 'A DIFFERENT title that should never be written',
      rawExcerpt: 'A DIFFERENT excerpt that should never be written',
    })

    expect(second.created).toBe(false)
    expect(second.item.id).toBe(first.item.id)
    expect(second.item.title).toBe('Original title')
    expect(second.item.rawExcerpt).toBe('Original excerpt')

    const db2 = db as unknown as { evidenceItem: { rows: unknown[] } }
    expect(db2.evidenceItem.rows.length).toBe(1) // no duplicate row created
  })
})

describe('ingestEvidenceItem — provenance-root assignment (requirement 4c/4d)', () => {
  it('a standalone item with no attribution is its own root', async () => {
    const db = makeFakeDb()
    const { item } = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 100,
      canonicalUrl: 'https://example.com/original',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Here we go! Player to Club',
      rawExcerpt: 'Deal agreed.',
    })
    expect(item.provenanceRootId).toBe(item.id)
    expect(item.parentEvidenceItemId).toBeNull()
  })

  it('explicit attribution links to the cited source and inherits its root', async () => {
    const db = makeFakeDb()
    const { item: original } = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 100,
      canonicalUrl: 'https://example.com/original',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Here we go! Player to Club',
      rawExcerpt: 'Deal agreed.',
    })

    const { item: syndicated } = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 101,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/syndicated',
      publishedAt: new Date('2026-01-01T00:15:00Z'),
      title: 'Player to Club, according to Fabrizio Romano',
      rawExcerpt: 'Sky Sports understands the deal is agreed, according to Fabrizio Romano.',
    })

    expect(syndicated.parentEvidenceItemId).toBe(original.id)
    expect(syndicated.provenanceRootId).toBe(original.provenanceRootId)
    expect(syndicated.provenanceRootId).toBe(original.id)
  })

  it('near-duplicate text without attribution logs a candidate but does NOT merge roots (requirement 4b)', async () => {
    const db = makeFakeDb()
    const { item: a } = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 101,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/a',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Jonathan David set to leave Juventus as a free agent this summer',
      rawExcerpt: 'Jonathan David is set to leave Juventus as a free agent this summer.',
    })
    const { item: b } = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 103,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/b',
      publishedAt: new Date('2026-01-01T00:20:00Z'),
      title: 'Jonathan David set to leave Juventus as a free agent this summer window',
      rawExcerpt: 'Jonathan David is set to leave Juventus this summer as a free agent, Marca reports.',
    })

    expect(a.provenanceRootId).toBe(a.id)
    expect(b.provenanceRootId).toBe(b.id) // NOT merged — still its own root
    expect(a.provenanceRootId).not.toBe(b.provenanceRootId)

    const db2 = db as unknown as { evidenceDuplicateCandidate: { rows: { evidenceItemId: number; candidateItemId: number }[] } }
    expect(db2.evidenceDuplicateCandidate.rows).toHaveLength(1)
    expect(db2.evidenceDuplicateCandidate.rows[0]).toMatchObject({ evidenceItemId: b.id, candidateItemId: a.id })
  })
})

// Requirement 7's named acceptance scenario.
describe('computeIndependentSourceCount — requirement 7', () => {
  it('five articles derived from one original report count as one independent source', async () => {
    const db = makeFakeDb()

    const { item: original } = await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 100,
      canonicalUrl: 'https://example.com/original',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Here we go! Viktor Gyökeres to Manchester City',
      rawExcerpt: 'Understand full agreement reached. Here we go!',
    })

    const syndications = [
      { sourceId: 101, sourceType: 'NEWS_OUTLET', url: 'https://example.com/1', phrase: 'according to Fabrizio Romano' },
      { sourceId: 102, sourceType: 'NEWS_OUTLET', url: 'https://example.com/2', phrase: 'as reported by Fabrizio Romano' },
      { sourceId: 103, sourceType: 'NEWS_OUTLET', url: 'https://example.com/3', phrase: 'per Fabrizio Romano' },
      { sourceId: 104, sourceType: 'SOCIAL_MEDIA', url: 'https://example.com/4', phrase: 'citing Fabrizio Romano' },
    ]

    for (const s of syndications) {
      await ingestEvidenceItem(db, {
        claimId: 1,
        sourceId: s.sourceId,
        sourceType: s.sourceType,
        canonicalUrl: s.url,
        publishedAt: new Date('2026-01-01T00:30:00Z'),
        title: `Gyökeres to Man City, ${s.phrase}`,
        rawExcerpt: `Deal is done, ${s.phrase}.`,
        extractionConfidence: 0.7,
      })
    }

    expect(await computeIndependentSourceCount(db, 1)).toBe(1)

    const provenance = await getClaimProvenance(db, 1)
    expect(provenance.evidenceCount).toBe(5)
    expect(provenance.independentSourceCount).toBe(1)
    expect(provenance.provenanceClusters).toHaveLength(1)
    expect(provenance.provenanceClusters[0].root.id).toBe(original.id)
    expect(provenance.provenanceClusters[0].syndicated).toHaveLength(4)
  })

  it('two genuinely independent scoops (no attribution between them) count as two', async () => {
    const db = makeFakeDb()
    await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 100,
      canonicalUrl: 'https://example.com/scoop-a',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Player to Club A, Romano reports',
      rawExcerpt: 'No attribution phrase here.',
    })
    await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 102,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/scoop-b',
      publishedAt: new Date('2026-01-01T01:00:00Z'),
      title: 'Completely unrelated coverage with no shared wording whatsoever',
      rawExcerpt: 'Also no attribution phrase.',
    })
    expect(await computeIndependentSourceCount(db, 1)).toBe(2)
  })
})

describe('getClaimProvenance — official confirmation/denial (requirement 6)', () => {
  it('surfaces the latest CLUB_OFFICIAL CONFIRMS item as officialConfirmation', async () => {
    const db = makeFakeDb()
    await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 100,
      canonicalUrl: 'https://example.com/rumour',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Rumour breaks',
      rawExcerpt: 'x',
    })
    await ingestEvidenceItem(db, {
      claimId: 1,
      sourceId: 105,
      sourceType: 'CLUB_OFFICIAL',
      canonicalUrl: 'https://club.example.com/official',
      publishedAt: new Date('2026-01-02T00:00:00Z'),
      title: 'Club confirms signing',
      rawExcerpt: 'Official statement.',
      evidenceDirection: 'CONFIRMS',
      extractionConfidence: 1,
    })

    const provenance = await getClaimProvenance(db, 1)
    expect(provenance.officialConfirmation?.title).toBe('Club confirms signing')
    expect(provenance.officialDenial).toBeNull()
  })
})

describe('resolveDuplicateCandidate — human-reviewed merge (requirement 4b)', () => {
  it('merge sets the candidate item\'s provenanceRootId to match the source item, and stamps reviewedAt', async () => {
    const db = makeFakeDb()
    await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 101,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/a',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Jonathan David set to leave Juventus as a free agent this summer',
      rawExcerpt: 'Jonathan David is set to leave Juventus as a free agent this summer.',
    })
    await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 103,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/b',
      publishedAt: new Date('2026-01-01T00:20:00Z'),
      title: 'Jonathan David set to leave Juventus as a free agent this summer window',
      rawExcerpt: 'Jonathan David is set to leave Juventus this summer as a free agent, Marca reports.',
    })

    const db2 = db as unknown as { evidenceDuplicateCandidate: { rows: { id: number }[] } }
    const candidateRowId = db2.evidenceDuplicateCandidate.rows[0].id

    await resolveDuplicateCandidate(db, candidateRowId, 'merge')

    expect(await computeIndependentSourceCount(db, 1)).toBe(1)

    const db3 = db as unknown as { evidenceDuplicateCandidate: { rows: { reviewedAt: Date | null }[] } }
    expect(db3.evidenceDuplicateCandidate.rows[0].reviewedAt).not.toBeNull()
  })

  it('reject leaves roots distinct but still stamps reviewedAt', async () => {
    const db = makeFakeDb()
    await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 101,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/a',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Jonathan David set to leave Juventus as a free agent this summer',
      rawExcerpt: 'Jonathan David is set to leave Juventus as a free agent this summer.',
    })
    await ingestEvidenceItem(db, {
      ...BASE_ITEM,
      sourceId: 103,
      sourceType: 'NEWS_OUTLET',
      canonicalUrl: 'https://example.com/b',
      publishedAt: new Date('2026-01-01T00:20:00Z'),
      title: 'Jonathan David set to leave Juventus as a free agent this summer window',
      rawExcerpt: 'Jonathan David is set to leave Juventus this summer as a free agent, Marca reports.',
    })

    const db2 = db as unknown as { evidenceDuplicateCandidate: { rows: { id: number; reviewedAt: Date | null }[] } }
    const candidateRowId = db2.evidenceDuplicateCandidate.rows[0].id

    await resolveDuplicateCandidate(db, candidateRowId, 'reject')

    expect(await computeIndependentSourceCount(db, 1)).toBe(2)
    expect(db2.evidenceDuplicateCandidate.rows[0].reviewedAt).not.toBeNull()
  })
})
