import { Suspense } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import FilterBar from '@/components/FilterBar'
import LiveRumourFeed from '@/components/LiveRumourFeed'
import type { RumourStatus, TransferWindow } from '@/types'

interface SearchParams {
  league?: string
  position?: string
  status?: string
  window?: string
  page?: string
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const page = parseInt(searchParams.page ?? '1', 10)

  const { data: rumours, total, limit } = await api.rumours.list({
    league: searchParams.league,
    position: searchParams.position,
    status: searchParams.status as RumourStatus | undefined,
    window: searchParams.window as TransferWindow | undefined,
    page,
    limit: 20,
  })

  const stats = await api.stats.overview()
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-8">
      {/* Hero stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Rumours', value: stats.totalRumours },
          { label: 'Hot Rumours', value: stats.hotRumours, accent: 'text-orange-400' },
          { label: 'Completed', value: stats.completedRumours, accent: 'text-pitch-500' },
        ].map(({ label, value, accent }) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p>
            <p className={`mt-1 text-3xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Network CTA */}
      <Link
        href="/network"
        className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-5 py-3 text-sm text-slate-300 transition-all hover:border-pitch-500/40 hover:bg-slate-800 hover:text-white group"
      >
        <span className="text-lg">🕸</span>
        <span>View transfer network graph</span>
        <span className="ml-auto text-slate-500 group-hover:text-pitch-500">→</span>
      </Link>

      {/* Filters */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Filter rumours
        </h2>
        <Suspense>
          <FilterBar />
        </Suspense>
      </section>

      {/* Live feed */}
      <LiveRumourFeed initialRumours={rumours} total={total} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={`?page=${p}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-pitch-500 text-white'
                  : 'border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
              }`}
            >
              {p}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
