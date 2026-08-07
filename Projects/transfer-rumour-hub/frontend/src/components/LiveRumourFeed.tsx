'use client'

import { useRumourFeed } from '@/lib/useRumourFeed'
import RumourCard from './RumourCard'
import type { Rumour } from '@/types'

interface Props {
  initialRumours: Rumour[]
  total: number
}

export default function LiveRumourFeed({ initialRumours, total }: Props) {
  const rumours = useRumourFeed(initialRumours)

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          {total} rumour{total !== 1 ? 's' : ''}
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-pitch-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pitch-500" />
          Live
        </span>
      </div>
      <div className="space-y-3">
        {rumours.map((r) => (
          <RumourCard key={r.id} rumour={r} />
        ))}
        {rumours.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
            <p className="text-slate-500">No rumours match your filters.</p>
          </div>
        )}
      </div>
    </section>
  )
}
