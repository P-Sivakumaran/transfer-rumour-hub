import { FREE_WATCHLIST_LIMIT } from './flags.js'

// Pure decision function, factored out of watchlistController.ts so the
// free/Pro boundary is unit-testable without a database. Count-then-decide,
// not atomic against concurrent callers — see the comment in
// watchlistController.ts for why that's an accepted soft-limit tradeoff.
export function canAddToFreeWatchlist(currentCount: number, alreadyWatchlisted: boolean): boolean {
  return alreadyWatchlisted || currentCount < FREE_WATCHLIST_LIMIT
}
