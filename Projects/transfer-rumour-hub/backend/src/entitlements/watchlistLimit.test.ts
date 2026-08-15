import { describe, it, expect } from 'vitest'
import { canAddToFreeWatchlist } from './watchlistLimit.js'
import { FREE_WATCHLIST_LIMIT } from './flags.js'

describe('canAddToFreeWatchlist', () => {
  it('allows the Nth add when N is below the free limit', () => {
    expect(canAddToFreeWatchlist(FREE_WATCHLIST_LIMIT - 1, false)).toBe(true)
  })

  it('blocks the (limit+1)th add for a new player once at the limit', () => {
    expect(canAddToFreeWatchlist(FREE_WATCHLIST_LIMIT, false)).toBe(false)
  })

  it('allows re-adding a player already on the watchlist even at the limit (no-op upsert, not growth)', () => {
    expect(canAddToFreeWatchlist(FREE_WATCHLIST_LIMIT, true)).toBe(true)
  })

  it('allows the very first add from zero', () => {
    expect(canAddToFreeWatchlist(0, false)).toBe(true)
  })
})
