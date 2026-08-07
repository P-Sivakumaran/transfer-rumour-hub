import { notFound } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import TruthMeter from '@/components/TruthMeter'
import TimelineChart from '@/components/TimelineChart'

export default async function RumourDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10)
  const rumour = await api.rumours.get(id).catch(() => null)
  if (!rumour) notFound()

  const fee =
    rumour.reportedFeeMin != null && rumour.reportedFeeMax != null
      ? `€${rumour.reportedFeeMin}–${rumour.reportedFeeMax}M`
      : rumour.reportedFeeMin != null
        ? `€${rumour.reportedFeeMin}M`
        : 'Undisclosed'

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-8">
        <TruthMeter
          score={Math.round(rumour.computedLikelihood)}
          status={rumour.status}
          size="lg"
        />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            <Link href={`/player/${rumour.player.id}`} className="hover:text-pitch-500">
              {rumour.player.name}
            </Link>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-lg">
            <Link href={`/club/${rumour.fromClub.id}`} className="font-medium text-slate-300 hover:text-white">
              {rumour.fromClub.name}
            </Link>
            <span className="text-2xl text-slate-600">→</span>
            <Link href={`/club/${rumour.toClub.id}`} className="font-medium text-slate-300 hover:text-white">
              {rumour.toClub.name}
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-400">
            <span>Fee: <strong className="text-white font-mono">{fee}</strong></span>
            <span>Window: <strong className="text-white">{rumour.window}</strong></span>
            <span>Position: <strong className="text-white">{rumour.player.position}</strong></span>
          </div>
        </div>
      </div>

      {/* Source */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Source</p>
        <div className="flex items-center gap-3">
          <span className="font-medium text-white">{rumour.source.name}</span>
          <span className="text-xs text-slate-500">{rumour.source.type.replace('_', ' ')}</span>
          <span className="ml-auto font-mono text-sm text-pitch-500">
            {Math.round(rumour.source.reliabilityScore * 100)}% reliable
          </span>
        </div>
      </div>

      {/* Likelihood timeline */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
          Likelihood over time
        </p>
        <TimelineChart history={rumour.history} />
      </div>

      {rumour.notes && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Notes</p>
          <p className="text-slate-300 text-sm leading-relaxed">{rumour.notes}</p>
        </div>
      )}
    </div>
  )
}
