'use client'

import { useState } from 'react'

export default function RemoveAdsBanner() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function checkout() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Checkout unavailable')
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout unavailable')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-2.5 text-sm">
      <span className="text-slate-400">Remove ads from Transfer Hub, forever.</span>
      <div className="flex items-center gap-3">
        {error && <span className="text-xs text-red-400">{error}</span>}
        <button
          onClick={checkout}
          disabled={loading}
          className="rounded-lg bg-pitch-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-pitch-600 disabled:opacity-50"
        >
          {loading ? 'Redirecting…' : 'Remove ads — £0.99'}
        </button>
      </div>
    </div>
  )
}
