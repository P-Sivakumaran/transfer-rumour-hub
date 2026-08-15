import { describe, it, expect, afterEach } from 'vitest'
import { checkEntitlement } from './resolver.js'

describe('checkEntitlement', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('allows a FREE user to use a FREE-tier-implicit feature it qualifies for', () => {
    // UNLIMITED_WATCHLIST requires PRO — a FREE user should be denied by tier,
    // not by the flag layer.
    const result = checkEntitlement('FREE', 'UNLIMITED_WATCHLIST')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('INSUFFICIENT_TIER')
    expect(result.requiredTier).toBe('PRO')
  })

  it('allows a PRO user to use a PRO-gated, enabled feature', () => {
    const result = checkEntitlement('PRO', 'UNLIMITED_WATCHLIST')
    expect(result.allowed).toBe(true)
  })

  it('allows a RESEARCH user through a PRO-gated feature (higher tier satisfies lower requirement)', () => {
    const result = checkEntitlement('RESEARCH', 'FORECAST_HISTORY')
    expect(result.allowed).toBe(true)
  })

  it('denies a PRO user a RESEARCH-only feature by tier', () => {
    const result = checkEntitlement('PRO', 'API_ACCESS')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('INSUFFICIENT_TIER')
  })

  it('denies CSV export to a PRO user by default — flag defaults off regardless of tier', () => {
    const result = checkEntitlement('PRO', 'CSV_EXPORT_WATCHLIST')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('FEATURE_DISABLED')
  })

  it('tier check takes priority over a disabled flag — insufficient tier is the more specific answer', () => {
    // FREE user hitting a PRO-gated feature that also happens to be
    // disabled by flag: the response should say "not on your plan," not
    // "temporarily disabled," since upgrading alone wouldn't have helped
    // either way but tier is the actionable fact for this user.
    const result = checkEntitlement('FREE', 'CSV_EXPORT_WATCHLIST')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('INSUFFICIENT_TIER')
  })

  it('respects an env override enabling a default-off flag', () => {
    process.env.FEATURE_CSV_EXPORT_WATCHLIST = 'true'
    const result = checkEntitlement('PRO', 'CSV_EXPORT_WATCHLIST')
    expect(result.allowed).toBe(true)
  })

  it('respects an env override disabling a default-on flag', () => {
    process.env.FEATURE_FORECAST_HISTORY = 'false'
    const result = checkEntitlement('PRO', 'FORECAST_HISTORY')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('FEATURE_DISABLED')
  })
})
