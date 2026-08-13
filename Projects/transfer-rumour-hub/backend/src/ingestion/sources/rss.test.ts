import { describe, it, expect } from 'vitest'
import { isTransferRelated } from './rss.js'

describe('isTransferRelated', () => {
  it('matches standard English transfer headlines', () => {
    expect(isTransferRelated('Club confirms medical for striker', '')).toBe(true)
    expect(isTransferRelated('Here we go: deal agreed', '')).toBe(true)
  })

  it('rejects unrelated English headlines', () => {
    expect(isTransferRelated('Match report: 3-1 win at the weekend', '')).toBe(false)
  })

  // Real headlines pulled from L'Équipe's mercato RSS feed (2026-08-13) —
  // French vocabulary doesn't overlap with the English keyword list except
  // for 'mercato', which every real transfer headline in that feed carries.
  it('matches real French mercato headlines via the mercato keyword', () => {
    expect(
      isTransferRelated(
        "Mercato : le capitaine de Tottenham Cristian Romero vers l'Atlético Madrid contre 40 M€",
        '',
      ),
    ).toBe(true)
    expect(
      isTransferRelated('Mercato : comme Julio Enciso, Abdoul Ouattara quitte Strasbourg pour Ipswich', ''),
    ).toBe(true)
  })

  it('rejects non-transfer French headlines from the same feed', () => {
    expect(isTransferRelated('Anderson : «Montrer à tout le monde ce dont je suis capable»', '')).toBe(false)
    expect(isTransferRelated('Luis Enrique toujours aussi affamé', '')).toBe(false)
  })
})
