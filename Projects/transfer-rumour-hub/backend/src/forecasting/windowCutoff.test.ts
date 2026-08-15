import { describe, it, expect } from 'vitest'
import { resolveWindowCutoff } from './windowCutoff.js'

const CONFIG = { summerCutoffMonthDay: '08-31', winterCutoffMonthDay: '01-31' }

describe('resolveWindowCutoff', () => {
  it('returns null for FREE_AGENT', () => {
    expect(resolveWindowCutoff('FREE_AGENT', new Date('2026-07-01'), CONFIG)).toBeNull()
  })

  it('returns null for a null window', () => {
    expect(resolveWindowCutoff(null, new Date('2026-07-01'), CONFIG)).toBeNull()
  })

  it('resolves SUMMER cutoff to Aug 31 of the same year when reference is before it', () => {
    const cutoff = resolveWindowCutoff('SUMMER', new Date('2026-07-01'), CONFIG)
    expect(cutoff?.toISOString().slice(0, 10)).toBe('2026-08-31')
  })

  it('rolls SUMMER cutoff to next year when reference is already past it', () => {
    const cutoff = resolveWindowCutoff('SUMMER', new Date('2026-09-15'), CONFIG)
    expect(cutoff?.toISOString().slice(0, 10)).toBe('2027-08-31')
  })

  it('resolves WINTER cutoff correctly across the year boundary', () => {
    const cutoff = resolveWindowCutoff('WINTER', new Date('2026-12-15'), CONFIG)
    expect(cutoff?.toISOString().slice(0, 10)).toBe('2027-01-31')
  })

  it('honors a non-default configured cutoff', () => {
    const cutoff = resolveWindowCutoff('SUMMER', new Date('2026-07-01'), { ...CONFIG, summerCutoffMonthDay: '09-01' })
    expect(cutoff?.toISOString().slice(0, 10)).toBe('2026-09-01')
  })
})
