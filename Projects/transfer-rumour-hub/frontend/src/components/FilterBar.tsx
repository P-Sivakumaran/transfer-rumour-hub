'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { clsx } from 'clsx'

const LEAGUES = ['Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1']
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']
const STATUSES = ['HOT', 'PENDING', 'COMPLETED', 'FAILED']
const WINDOWS = ['SUMMER', 'WINTER']

export default function FilterBar() {
  const router = useRouter()
  const params = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (next.get(key) === value) {
        next.delete(key)
      } else {
        next.set(key, value)
        next.delete('page')
      }
      router.push(`?${next.toString()}`)
    },
    [params, router],
  )

  function Chip({ label, filterKey, value }: { label: string; filterKey: string; value: string }) {
    const active = params.get(filterKey) === value
    return (
      <button
        onClick={() => update(filterKey, value)}
        className={clsx(
          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          active
            ? 'border-pitch-500 bg-pitch-500/20 text-pitch-500'
            : 'border-slate-700 bg-transparent text-slate-400 hover:border-slate-500 hover:text-slate-200',
        )}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">Status</span>
        {STATUSES.map((s) => <Chip key={s} label={s} filterKey="status" value={s} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">League</span>
        {LEAGUES.map((l) => <Chip key={l} label={l} filterKey="league" value={l} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">Pos</span>
        {POSITIONS.map((p) => <Chip key={p} label={p} filterKey="position" value={p} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">Window</span>
        {WINDOWS.map((w) => <Chip key={w} label={w} filterKey="window" value={w} />)}
      </div>
    </div>
  )
}
