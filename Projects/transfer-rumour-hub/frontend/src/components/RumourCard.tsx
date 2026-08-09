'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Rumour } from '@/types'
import TruthMeter from './TruthMeter'
import { clsx } from 'clsx'

interface Props {
  rumour: Rumour
  compact?: boolean
}

const STATUS_BADGE: Record<string, string> = {
  HOT: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  PENDING: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
  COMPLETED: 'bg-green-500/20 text-green-400 border-green-500/40',
  FAILED: 'bg-red-500/20 text-red-400 border-red-500/40',
  DENIED: 'bg-gray-700/40 text-gray-400 border-gray-600/40',
}

const SOURCE_TYPE_COLORS: Record<string, string> = {
  JOURNALIST: 'bg-blue-500/20 text-blue-300',
  NEWS_OUTLET: 'bg-purple-500/20 text-purple-300',
  CLUB_OFFICIAL: 'bg-emerald-500/20 text-emerald-300',
  AGENT: 'bg-yellow-500/20 text-yellow-300',
  SOCIAL_MEDIA: 'bg-pink-500/20 text-pink-300',
  AGGREGATOR: 'bg-slate-500/20 text-slate-300',
}

function ReliabilityDots({ score }: { score: number }) {
  const filled = Math.round(score * 5)
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={clsx('h-1.5 w-1.5 rounded-full', i < filled ? 'bg-emerald-400' : 'bg-slate-600')}
        />
      ))}
    </span>
  )
}

function feeLabel(min: number | null, max: number | null, currency: string): string {
  if (min == null && max == null) return 'Undisclosed'
  if (min != null && max != null) return `€${min}–${max}M`
  return `€${min ?? max}M`
}

export default function RumourCard({ rumour, compact = false }: Props) {
  const router = useRouter()

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/rumour/${rumour.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(`/rumour/${rumour.id}`)
      }}
      className={clsx(
        'group relative flex cursor-pointer gap-4 rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 backdrop-blur-sm',
        'transition-all duration-200 hover:border-slate-500 hover:bg-slate-800 hover:shadow-lg hover:shadow-black/30',
        compact ? 'items-center' : 'flex-col sm:flex-row sm:items-start',
      )}
    >
      {/* Truth meter */}
      <div className="flex-shrink-0">
        <TruthMeter score={Math.round(rumour.computedLikelihood)} status={rumour.status} size={compact ? 'sm' : 'md'} />
      </div>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        {/* Player + transfer arrow */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/player/${rumour.player.id}`}
            className="text-base font-semibold text-white hover:text-pitch-500"
            onClick={(e) => e.stopPropagation()}
          >
            {rumour.player.name}
          </Link>
          <span className="rounded-full border px-2 py-0.5 text-xs font-mono font-medium text-slate-300 border-slate-600">
            {rumour.player.position}
          </span>
          <span
            className={clsx(
              'rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
              STATUS_BADGE[rumour.status],
            )}
          >
            {rumour.status}
          </span>
        </div>

        {/* Club transfer row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
          <Link
            href={`/club/${rumour.fromClub.id}`}
            className="font-medium text-slate-300 hover:text-white"
            onClick={(e) => e.stopPropagation()}
          >
            {rumour.fromClub.shortName ?? rumour.fromClub.name}
          </Link>
          <span className="text-slate-500">→</span>
          <Link
            href={`/club/${rumour.toClub.id}`}
            className="font-medium text-slate-300 hover:text-white"
            onClick={(e) => e.stopPropagation()}
          >
            {rumour.toClub.shortName ?? rumour.toClub.name}
          </Link>
          <span className="ml-1 font-mono text-slate-400">
            {feeLabel(rumour.reportedFeeMin, rumour.reportedFeeMax, rumour.currency)}
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-500">{rumour.window}</span>
        </div>

        {/* Source chip + reliability */}
        {!compact && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                SOURCE_TYPE_COLORS[rumour.source.type] ?? 'bg-slate-600/40 text-slate-300',
              )}
            >
              {rumour.source.name}
            </span>
            <ReliabilityDots score={rumour.source.reliabilityScore} />
            {rumour.distinctSourceCount > 1 && (
              <span className="text-xs text-slate-500">+{rumour.distinctSourceCount - 1} more source{rumour.distinctSourceCount > 2 ? 's' : ''}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
