import { describe, it, expect } from 'vitest'
import { resolveDirection } from './entityMatcher.js'

const strasbourg = { id: 1, name: 'RC Strasbourg', shortName: 'Strasbourg', league: 'Ligue 1' }
const ipswich = { id: 2, name: 'Ipswich Town', shortName: 'Ipswich', league: 'Championship' }
const clubs = [strasbourg, ipswich]
const mentioned = [
  { id: strasbourg.id, name: strasbourg.name, score: 1 },
  { id: ipswich.id, name: ipswich.name, score: 1 },
]

describe('resolveDirection — French cues (L’Équipe mercato feed)', () => {
  it('resolves "quitte X pour Y" the same way "leaves X for Y" resolves', () => {
    const text = 'Abdoul Ouattara quitte Strasbourg pour Ipswich'
    const result = resolveDirection(text.toLowerCase(), text, clubs, mentioned)
    expect(result.fromClub?.id).toBe(strasbourg.id)
    expect(result.toClub?.id).toBe(ipswich.id)
  })

  it('resolves the real fixture headline from rss.test.ts end to end', () => {
    const text = 'Mercato : comme Julio Enciso, Abdoul Ouattara quitte Strasbourg pour Ipswich'
    const result = resolveDirection(text.toLowerCase(), text, clubs, mentioned)
    expect(result.fromClub?.id).toBe(strasbourg.id)
    expect(result.toClub?.id).toBe(ipswich.id)
  })

  it('resolves a standalone "rejoint Y" as a TO cue', () => {
    const text = 'Ouattara rejoint Ipswich Town'
    const result = resolveDirection(text.toLowerCase(), text, clubs, mentioned)
    expect(result.toClub?.id).toBe(ipswich.id)
  })

  it('resolves a standalone "quitte X" as a FROM cue when there is no "pour Y"', () => {
    const text = 'Ouattara quitte Strasbourg cet été'
    const result = resolveDirection(text.toLowerCase(), text, clubs, mentioned)
    expect(result.fromClub?.id).toBe(strasbourg.id)
  })

  it('still resolves the original English "leaves X for Y" construction unchanged', () => {
    const text = 'Ouattara leaves Strasbourg for Ipswich'
    const result = resolveDirection(text.toLowerCase(), text, clubs, mentioned)
    expect(result.fromClub?.id).toBe(strasbourg.id)
    expect(result.toClub?.id).toBe(ipswich.id)
  })

  it('does not fabricate a direction when neither an English nor French cue is present', () => {
    const text = 'Strasbourg and Ipswich both interested in Ouattara'
    const result = resolveDirection(text.toLowerCase(), text, clubs, mentioned)
    expect(result.fromClub).toBeNull()
    expect(result.toClub).toBeNull()
  })
})
