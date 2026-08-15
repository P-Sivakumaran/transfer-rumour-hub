import { describe, it, expect } from 'vitest'
import { categorizeEvidence, allEvidenceChronological, findRootFor, isRoot } from './evidenceCategories'
import { gyokeresClaimDetail, original, syndication1, officialConfirmationItem, davidClaimDetail, davidDenialItem } from '@/test/fixtures'

describe('categorizeEvidence', () => {
  it('categorizes the original scoop as original reporting, not corroboration or syndication', () => {
    const cats = categorizeEvidence(original, gyokeresClaimDetail)
    expect(cats).toContain('original')
    expect(cats).not.toContain('syndication')
    expect(cats).not.toContain('corroboration')
  })

  it('categorizes a syndicated copy as syndication, not original', () => {
    const cats = categorizeEvidence(syndication1, gyokeresClaimDetail)
    expect(cats).toContain('syndication')
    expect(cats).not.toContain('original')
  })

  it('categorizes an official confirmation as official (and not original reporting)', () => {
    const cats = categorizeEvidence(officialConfirmationItem, gyokeresClaimDetail)
    expect(cats).toContain('official')
    expect(cats).not.toContain('original')
    expect(cats).not.toContain('corroboration')
  })

  it('categorizes an official denial as both official and denial', () => {
    const cats = categorizeEvidence(davidDenialItem, davidClaimDetail)
    expect(cats).toContain('official')
    expect(cats).toContain('denial')
  })
})

describe('isRoot / findRootFor', () => {
  it('identifies root vs. syndicated items correctly', () => {
    expect(isRoot(original)).toBe(true)
    expect(isRoot(syndication1)).toBe(false)
  })

  it('finds the root a syndicated item shares a provenance root with', () => {
    const root = findRootFor(syndication1, gyokeresClaimDetail)
    expect(root?.id).toBe(original.id)
  })

  it('returns null when asked for the root of an item that is itself a root', () => {
    expect(findRootFor(original, gyokeresClaimDetail)).toBeNull()
  })
})

describe('allEvidenceChronological', () => {
  it('returns every evidence item across all clusters, sorted by publish time', () => {
    const items = allEvidenceChronological(gyokeresClaimDetail)
    expect(items).toHaveLength(6)
    const times = items.map((i) => new Date(i.publishedAt).getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})
