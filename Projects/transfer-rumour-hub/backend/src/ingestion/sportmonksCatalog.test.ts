import { describe, it, expect } from 'vitest'
import { SportmonksSquadMemberSchema } from './sportmonksCatalog.js'

const BASE_MEMBER = {
  player_id: 1,
  position_id: 1,
  detailed_position_id: 1,
  player: {
    id: 1,
    display_name: 'Test Player',
    date_of_birth: '2000-01-01',
    image_path: null,
    nationality: null,
  },
}

describe('SportmonksSquadMemberSchema', () => {
  it('accepts an explicit end date', () => {
    const parsed = SportmonksSquadMemberSchema.parse({ ...BASE_MEMBER, end: '2028-06-30' })
    expect(parsed.end).toBe('2028-06-30')
  })

  it('accepts an explicit null end', () => {
    const parsed = SportmonksSquadMemberSchema.parse({ ...BASE_MEMBER, end: null })
    expect(parsed.end).toBeNull()
  })

  it('accepts a squad member with the end key omitted entirely (e.g. trialist/youth/loan rows)', () => {
    const parsed = SportmonksSquadMemberSchema.parse({ ...BASE_MEMBER })
    expect(parsed.end).toBeUndefined()
  })
})
