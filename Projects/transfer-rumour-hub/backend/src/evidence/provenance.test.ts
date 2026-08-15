import { describe, it, expect } from 'vitest'
import { textSimilarity, detectAttributionPhrase, matchAttributedSource, DUPLICATE_CANDIDATE_THRESHOLD } from './provenance.js'

describe('textSimilarity', () => {
  it('returns 1 for identical text', () => {
    expect(textSimilarity('Gyökeres to Man City', 'Gyökeres to Man City')).toBe(1)
  })

  it('returns 0 for completely disjoint text', () => {
    expect(textSimilarity('aaa bbb ccc', 'xxx yyy zzz')).toBe(0)
  })

  it('scores near-duplicate headlines above the candidate threshold', () => {
    const a = 'Jonathan David set to leave Juventus as a free agent this summer'
    const b = 'Jonathan David set to leave Juventus as a free agent this summer window'
    expect(textSimilarity(a, b)).toBeGreaterThanOrEqual(DUPLICATE_CANDIDATE_THRESHOLD)
  })

  it('scores unrelated transfer headlines below the candidate threshold', () => {
    const a = 'Jonathan David set to leave Juventus as a free agent this summer'
    const b = 'Manchester City complete signing of Viktor Gyökeres from Arsenal'
    expect(textSimilarity(a, b)).toBeLessThan(DUPLICATE_CANDIDATE_THRESHOLD)
  })
})

describe('detectAttributionPhrase', () => {
  it('detects "according to X"', () => {
    expect(detectAttributionPhrase('Gyökeres to Man City, according to Fabrizio Romano')?.citedName).toBe(
      'Fabrizio Romano',
    )
  })

  it('detects "as reported by X"', () => {
    expect(detectAttributionPhrase('deal agreed as reported by Fabrizio Romano')?.citedName).toBe('Fabrizio Romano')
  })

  it('detects "as first reported by X"', () => {
    expect(detectAttributionPhrase('as first reported by The Athletic')?.citedName).toBe('The Athletic')
  })

  it('detects "per X" and "citing X"', () => {
    expect(detectAttributionPhrase('deal done, per Fabrizio Romano')?.citedName).toBe('Fabrizio Romano')
    expect(detectAttributionPhrase('CONFIRMED citing Fabrizio Romano')?.citedName).toBe('Fabrizio Romano')
  })

  it('returns null when no attribution phrasing is present', () => {
    expect(detectAttributionPhrase('Manchester City complete signing of Viktor Gyökeres')).toBeNull()
  })
})

describe('matchAttributedSource', () => {
  const sources = [
    { id: 1, name: 'Fabrizio Romano' },
    { id: 2, name: 'Sky Sports' },
    { id: 3, name: 'Sky Sports News' },
  ]

  it('matches exact (case-insensitive) name', () => {
    expect(matchAttributedSource('fabrizio romano', sources)?.id).toBe(1)
  })

  it('does not let a shorter name substring-match a longer, distinct source', () => {
    // "Sky" alone should not resolve to either Sky Sports source — it's not
    // a whole-name match for either.
    expect(matchAttributedSource('Sky', sources)).toBeNull()
  })

  it('returns null for an unknown cited name', () => {
    expect(matchAttributedSource('Some Random Blog', sources)).toBeNull()
  })
})
