import { describe, it, expect } from 'vitest'
import { SportmonksResponseSchema, normalize } from './sportmonks.js'

// Real shapes, captured live 2026-08-16 against /transfers/latest — not
// guessed. The old schema (transfer: boolean, type: enum, pagination.
// last_page) never matched this and would have thrown on every real
// response — see the comment block at the top of sportmonks.ts.
const REAL_TRANSFER = {
  id: 589042,
  sport_id: 1,
  player_id: 446911,
  type_id: 219,
  from_team_id: 392,
  to_team_id: 260131,
  position_id: 25,
  detailed_position_id: 148,
  date: '2026-08-15',
  career_ended: false,
  completed: true,
  amount: null,
}

describe('SportmonksResponseSchema', () => {
  it('parses a real /transfers/latest response, extra fields and all', () => {
    const parsed = SportmonksResponseSchema.parse({
      data: [REAL_TRANSFER],
      pagination: { count: 1, per_page: 50, has_more: true, current_page: 1 },
    })
    expect(parsed.data).toHaveLength(1)
    expect(parsed.pagination?.has_more).toBe(true)
  })

  it('parses a response with no pagination object (last page)', () => {
    const parsed = SportmonksResponseSchema.parse({ data: [REAL_TRANSFER] })
    expect(parsed.pagination).toBeUndefined()
  })

  it('does not require the old, never-actually-present transfer/type fields (regression)', () => {
    expect(() => SportmonksResponseSchema.parse({ data: [REAL_TRANSFER] })).not.toThrow()
  })

  it('does not require a pagination.last_page field (regression — real API has none)', () => {
    const parsed = SportmonksResponseSchema.parse({
      data: [REAL_TRANSFER],
      pagination: { count: 1, per_page: 50, has_more: false, current_page: 3 },
    })
    expect(parsed.pagination?.has_more).toBe(false)
  })
})

describe('normalize', () => {
  it('maps a real transfer row to a NormalizedRumour', () => {
    const parsed = SportmonksResponseSchema.parse({ data: [REAL_TRANSFER] })
    const result = normalize(parsed.data[0])
    expect(result.externalId).toBe('sm-589042')
    expect(result.playerExternalId).toBe('sm-player-446911')
    expect(result.fromClubExternalId).toBe('sm-club-392')
    expect(result.toClubExternalId).toBe('sm-club-260131')
    expect(result.baseProbability).toBe(1) // completed: true
  })

  it('gives a pending (not completed) transfer a lower baseProbability', () => {
    const parsed = SportmonksResponseSchema.parse({ data: [{ ...REAL_TRANSFER, completed: false }] })
    const result = normalize(parsed.data[0])
    expect(result.baseProbability).toBe(0.5)
  })

  it('handles a null amount without throwing (no fee reported)', () => {
    const parsed = SportmonksResponseSchema.parse({ data: [REAL_TRANSFER] })
    const result = normalize(parsed.data[0])
    expect(result.reportedFeeMin).toBeNull()
    expect(result.reportedFeeMax).toBeNull()
  })

  it('handles a null date by falling back to now rather than throwing', () => {
    const parsed = SportmonksResponseSchema.parse({ data: [{ ...REAL_TRANSFER, date: null }] })
    expect(() => normalize(parsed.data[0])).not.toThrow()
  })
})
