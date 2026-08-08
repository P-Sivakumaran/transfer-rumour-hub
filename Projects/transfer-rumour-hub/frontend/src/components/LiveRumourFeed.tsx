'use client'

import { Fragment } from 'react'
import { useRumourFeed } from '@/lib/useRumourFeed'
import RumourCard from './RumourCard'
import AdSlot from './AdSlot'
import type { Rumour } from '@/types'

interface Props {
  initialRumours: Rumour[]
  total: number
  adsEnabled?: boolean
}

const AD_EVERY_N_CARDS = 5

export default function LiveRumourFeed({ initialRumours, total, adsEnabled = false }: Props) {
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
        {rumours.map((r, i) => (
          <Fragment key={r.id}>
            <RumourCard rumour={r} />
            {adsEnabled && i > 0 && (i + 1) % AD_EVERY_N_CARDS === 0 && (
              <AdSlot index={Math.floor(i / AD_EVERY_N_CARDS)} />
            )}
          </Fragment>
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
