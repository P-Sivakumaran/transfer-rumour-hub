/**
 * Provenance-first evidence ingestion. Not yet called from the live RSS/
 * Sportmonks pipeline (workers.ts) — see the schema.prisma comment above the
 * Claim model and README "Picking this up in a new session" for why that's
 * a deliberate, separate follow-up rather than done here.
 */
import type { EvidenceDb, EvidenceItemRow } from './db.js'
import {
  textSimilarity,
  detectAttributionPhrase,
  matchAttributedSource,
  DUPLICATE_CANDIDATE_THRESHOLD,
} from './provenance.js'

export interface IngestEvidenceInput {
  claimId: number
  sourceId: number
  canonicalUrl: string
  publishedAt: Date
  authorName?: string | null
  sourceType: string // SourceType enum value
  title: string
  rawExcerpt: string
  extractedAttributions?: unknown
  evidenceDirection?: string // EvidenceDirection enum value, default SUPPORTS
  extractionConfidence?: number
}

export interface IngestEvidenceResult {
  item: EvidenceItemRow
  created: boolean // false when this was a non-destructive re-ingest of an existing (canonicalUrl, claimId) pair
}

/**
 * Requirement 4a (exact URL = duplicate) + requirement 3 (non-destructive):
 * re-ingesting an already-seen (canonicalUrl, claimId) pair never touches
 * the originally captured title/rawExcerpt/attributions — only `fetchedAt`
 * advances, recording that the same evidence was observed again.
 *
 * Requirement 4c/4d (attribution → shared provenance root): if the text
 * explicitly cites a known source, and that source already has evidence on
 * this claim, the new item becomes a child of the earliest such item and
 * inherits its `provenanceRootId`. Otherwise the new item is its own root
 * (self-referential — see schema.prisma comment above the Claim model).
 *
 * Requirement 4b (near-duplicates are candidates, never automatic merges):
 * title/body similarity above DUPLICATE_CANDIDATE_THRESHOLD against other
 * evidence on the same claim is logged to EvidenceDuplicateCandidate, but
 * never changes provenanceRootId by itself — only detectAttributionPhrase's
 * explicit-citation path does that. Promoting a candidate to a shared root
 * is a deliberate separate call: resolveDuplicateCandidate().
 */
export async function ingestEvidenceItem(
  db: EvidenceDb,
  input: IngestEvidenceInput,
): Promise<IngestEvidenceResult> {
  const existing = await db.evidenceItem.findFirst({
    where: { canonicalUrl: input.canonicalUrl, claimId: input.claimId },
  })
  if (existing) {
    const updated = await db.evidenceItem.update({
      where: { id: existing.id },
      data: { fetchedAt: new Date() },
    })
    return { item: updated, created: false }
  }

  const combinedText = `${input.title} ${input.rawExcerpt}`

  // ── Attribution: explicit citation to a known source already on this claim ──
  let parentEvidenceItemId: number | null = null
  let inheritedRootId: number | null = null

  const attribution = detectAttributionPhrase(combinedText)
  if (attribution) {
    const candidateSources = await db.source.findMany({ where: { id: { not: input.sourceId } } })
    const matchedSource = matchAttributedSource(attribution.citedName, candidateSources)
    if (matchedSource) {
      // Earliest evidence from the cited source on this claim — the actual
      // origin being cited, not a later article from the same outlet.
      const claimEvidenceFromMatchedSource = await db.evidenceItem.findMany({
        where: { claimId: input.claimId, sourceId: matchedSource.id },
      })
      const parent = claimEvidenceFromMatchedSource.sort(
        (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
      )[0]
      if (parent) {
        parentEvidenceItemId = parent.id
        inheritedRootId = parent.provenanceRootId
      }
    }
  }

  // ── Near-duplicate candidates against existing evidence on this claim ──
  const existingForClaim = await db.evidenceItem.findMany({ where: { claimId: input.claimId } })
  const duplicateCandidates = existingForClaim
    .map((item) => ({
      item,
      score: textSimilarity(combinedText, `${item.title} ${item.rawExcerpt}`),
    }))
    .filter(({ score }) => score >= DUPLICATE_CANDIDATE_THRESHOLD)

  const created = await db.evidenceItem.create({
    data: {
      claimId: input.claimId,
      sourceId: input.sourceId,
      canonicalUrl: input.canonicalUrl,
      publishedAt: input.publishedAt,
      authorName: input.authorName ?? null,
      sourceType: input.sourceType,
      title: input.title,
      rawExcerpt: input.rawExcerpt,
      extractedAttributions: input.extractedAttributions ?? null,
      evidenceDirection: input.evidenceDirection ?? 'SUPPORTS',
      parentEvidenceItemId,
      provenanceRootId: inheritedRootId,
      extractionConfidence: input.extractionConfidence ?? 0,
    },
  })

  // Self-assign root when no attribution parent supplied one — two-phase
  // write because the id doesn't exist until after create().
  let finalItem = created
  if (inheritedRootId === null) {
    finalItem = await db.evidenceItem.update({
      where: { id: created.id },
      data: { provenanceRootId: created.id },
    })
  }

  for (const { item, score } of duplicateCandidates) {
    await db.evidenceDuplicateCandidate.create({
      data: { evidenceItemId: finalItem.id, candidateItemId: item.id, similarityScore: score },
    })
  }

  const claim = await db.claim.findFirst({ where: { id: input.claimId } })
  if (claim && input.publishedAt.getTime() > claim.lastEvidenceAt.getTime()) {
    await db.claim.update({
      where: { id: input.claimId },
      data: { lastEvidenceAt: input.publishedAt },
    })
  }

  return { item: finalItem, created: true }
}

/** Requirement 4e: only distinct provenance roots count toward corroboration. */
export async function computeIndependentSourceCount(db: EvidenceDb, claimId: number): Promise<number> {
  const items = await db.evidenceItem.findMany({ where: { claimId } })
  return new Set(items.map((i) => i.provenanceRootId)).size
}

export interface ProvenanceCluster {
  root: EvidenceItemRow
  syndicated: EvidenceItemRow[]
}

export interface ClaimProvenance {
  evidenceCount: number
  independentSourceCount: number
  provenanceClusters: ProvenanceCluster[]
  officialConfirmation: EvidenceItemRow | null
  officialDenial: EvidenceItemRow | null
}

/** Requirement 6: evidence count, independent-source count, original vs.
 * syndicated grouping, and official confirmation/denial in one call. */
export async function getClaimProvenance(db: EvidenceDb, claimId: number): Promise<ClaimProvenance> {
  const items = await db.evidenceItem.findMany({ where: { claimId } })

  const clustersByRoot = new Map<number, EvidenceItemRow[]>()
  for (const item of items) {
    const rootId = item.provenanceRootId ?? item.id
    const list = clustersByRoot.get(rootId) ?? []
    list.push(item)
    clustersByRoot.set(rootId, list)
  }

  const provenanceClusters: ProvenanceCluster[] = []
  for (const [rootId, members] of clustersByRoot) {
    const root = members.find((m) => m.id === rootId) ?? members[0]
    const syndicated = members.filter((m) => m.id !== root.id)
    provenanceClusters.push({ root, syndicated })
  }

  // "Official" = CLUB_OFFICIAL source type explicitly confirming/denying —
  // an official's SUPPORTS/CONTEXTUAL mention isn't a confirmation.
  const officialConfirmation =
    items
      .filter((i) => i.sourceType === 'CLUB_OFFICIAL' && i.evidenceDirection === 'CONFIRMS')
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0] ?? null
  const officialDenial =
    items
      .filter((i) => i.sourceType === 'CLUB_OFFICIAL' && i.evidenceDirection === 'DENIES')
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0] ?? null

  return {
    evidenceCount: items.length,
    independentSourceCount: clustersByRoot.size,
    provenanceClusters,
    officialConfirmation,
    officialDenial,
  }
}

/**
 * Human-reviewed promotion of a near-duplicate candidate (requirement 4b) —
 * the only path (besides explicit attribution) that merges two provenance
 * clusters. Never runs automatically.
 */
export async function resolveDuplicateCandidate(
  db: EvidenceDb,
  candidateRowId: number,
  action: 'merge' | 'reject',
): Promise<void> {
  const [candidateRow] = await db.evidenceDuplicateCandidate.findMany({ where: { id: candidateRowId } })
  if (!candidateRow) return

  if (action === 'merge') {
    const [sourceItem] = await db.evidenceItem.findMany({ where: { id: candidateRow.evidenceItemId } })
    if (sourceItem) {
      await db.evidenceItem.update({
        where: { id: candidateRow.candidateItemId },
        data: { provenanceRootId: sourceItem.provenanceRootId },
      })
    }
  }

  await db.evidenceDuplicateCandidate.update({
    where: { id: candidateRowId },
    data: { reviewedAt: new Date() },
  })
}
