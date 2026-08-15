'use client'

import { useState } from 'react'
import Link from 'next/link'
import UpgradePrompt from './UpgradePrompt'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props {
  playerId: number
  initialWatched: boolean
  authenticated: boolean
}

export default function WatchlistButton({ playerId, initialWatched, authenticated }: Props) {
  const [watched, setWatched] = useState(initialWatched)
  const [pending, setPending] = useState(false)
  const [limitReached, setLimitReached] = useState(false)

  if (!authenticated) {
    return (
      <Link
        href="/login"
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
      >
        Log in to watch
      </Link>
    )
  }

  async function toggle(): Promise<void> {
    setPending(true)
    try {
      if (watched) {
        await fetch(`${BASE}/watchlist/${playerId}`, { method: 'DELETE', credentials: 'include' })
        setWatched(false)
        setLimitReached(false)
        return
      }

      const res = await fetch(`${BASE}/watchlist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })

      if (res.status === 403) {
        // Free-tier watchlist cap (entitlements/watchlistLimit.ts) — server
        // is the source of truth, this UI just surfaces its answer. See
        // docs/monetisation-proposal.md — requirement 3: never rely only on
        // frontend gating.
        setLimitReached(true)
        return
      }

      setWatched(true)
      setLimitReached(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={toggle}
        disabled={pending}
        className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
          watched
            ? 'border-pitch-500 bg-pitch-500/10 text-pitch-500'
            : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
        }`}
      >
        {watched ? '★ Watching' : '☆ Watch'}
      </button>
      {limitReached && (
        <UpgradePrompt
          description="Free watchlists hold up to 5 players. Unlimited watchlists are part of Supporter/Pro."
          requiredTier="PRO"
          featureKey="UNLIMITED_WATCHLIST"
          compact
        />
      )}
    </div>
  )
}
