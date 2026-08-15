/**
 * Maps each EvidenceItem to the filter categories EvidenceTimeline exposes.
 * An item can match more than one category (e.g. an official denial is
 * both `official` and `denial`) — filters are additive/OR, not exclusive,
 * same interaction model as FilterBar's existing chip toggles.
 */
import type { ClaimDetail, EvidenceItemData } from '@/types'

export type EvidenceCategory = 'official' | 'original' | 'corroboration' | 'syndication' | 'denial' | 'contextual'

export const EVIDENCE_CATEGORIES: { key: EvidenceCategory; label: string }[] = [
  { key: 'official', label: 'Official' },
  { key: 'original', label: 'Original reporting' },
  { key: 'corroboration', label: 'Independent corroboration' },
  { key: 'syndication', label: 'Syndication' },
  { key: 'denial', label: 'Denial' },
  { key: 'contextual', label: 'Contextual' },
]

export function isRoot(item: EvidenceItemData): boolean {
  return (item.provenanceRootId ?? item.id) === item.id
}

export function categorizeEvidence(item: EvidenceItemData, claim: ClaimDetail): EvidenceCategory[] {
  const categories: EvidenceCategory[] = []

  if (item.sourceType === 'CLUB_OFFICIAL') categories.push('official')
  if (item.evidenceDirection === 'DENIES') categories.push('denial')
  if (item.evidenceDirection === 'CONTEXTUAL') categories.push('contextual')

  if (isRoot(item)) {
    const isBreakingReport =
      item.sourceType !== 'CLUB_OFFICIAL' && item.evidenceDirection !== 'DENIES' && item.evidenceDirection !== 'CONTEXTUAL'
    if (isBreakingReport) {
      const breakingRoots = claim.provenanceClusters
        .map((c) => c.root)
        .filter((r) => r.sourceType !== 'CLUB_OFFICIAL' && r.evidenceDirection !== 'DENIES' && r.evidenceDirection !== 'CONTEXTUAL')
        .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
      categories.push(breakingRoots[0]?.id === item.id ? 'original' : 'corroboration')
    }
  } else {
    categories.push('syndication')
  }

  return categories
}

export function allEvidenceChronological(claim: ClaimDetail): EvidenceItemData[] {
  return claim.provenanceClusters
    .flatMap((c) => [c.root, ...c.syndicated])
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
}

export function findRootFor(item: EvidenceItemData, claim: ClaimDetail): EvidenceItemData | null {
  if (isRoot(item)) return null
  const cluster = claim.provenanceClusters.find((c) => c.syndicated.some((s) => s.id === item.id))
  return cluster?.root ?? null
}
