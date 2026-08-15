'use client'

import type { ClaimDetail } from '@/types'
import { deriveForecastFactors, topFactors, whatWouldChangeThis } from '@/lib/forecastFactors'
import { ArrowUpIcon, ArrowDownIcon, LinkIcon, HelpCircleIcon } from './icons'

interface Props {
  claim: ClaimDetail | null
  isLoading?: boolean
  error?: string | null
}

function findEvidenceItem(claim: ClaimDetail, id: number | undefined) {
  if (id == null) return null
  for (const cluster of claim.provenanceClusters) {
    if (cluster.root.id === id) return cluster.root
    const match = cluster.syndicated.find((e) => e.id === id)
    if (match) return match
  }
  return null
}

function FactorRow({ claim, factor }: { claim: ClaimDetail; factor: ReturnType<typeof deriveForecastFactors>[number] }) {
  const evidence = findEvidenceItem(claim, factor.evidenceItemId)
  const positive = factor.direction === 'positive'
  return (
    <li className="flex items-start gap-2.5 py-2">
      {positive ? (
        <ArrowUpIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-pitch-500" />
      ) : (
        <ArrowDownIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{factor.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{factor.explanation}</p>
        {evidence && (
          <a
            href={evidence.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-pitch-500 hover:underline"
          >
            <LinkIcon className="h-3 w-3" />
            View evidence
          </a>
        )}
      </div>
    </li>
  )
}

export default function WhyThisForecast({ claim, isLoading = false, error = null }: Props) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="why-loading">
        <div className="animate-pulse space-y-2">
          <div className="h-3 w-40 rounded bg-slate-800" />
          <div className="h-3 w-full rounded bg-slate-800" />
          <div className="h-3 w-5/6 rounded bg-slate-800" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="why-error">
        <p className="text-sm text-slate-500">Couldn&apos;t load forecast factors: {error}</p>
      </div>
    )
  }

  if (!claim) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="why-empty">
        <p className="text-sm text-slate-500">No claim data available.</p>
      </div>
    )
  }

  const factors = deriveForecastFactors(claim)
  const positives = topFactors(factors, 'positive')
  const negatives = topFactors(factors, 'negative')
  const changes = whatWouldChangeThis(claim)

  if (factors.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="why-no-factors">
        <div className="flex items-start gap-2.5">
          <HelpCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-500" />
          <p className="text-sm text-slate-500">Not enough evidence yet to explain this forecast.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="why-this-forecast">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Why this forecast</p>

      <div className="mt-3 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-pitch-500">Strongest support</h3>
          {positives.length > 0 ? (
            <ul className="divide-y divide-slate-800/60">
              {positives.map((f, i) => (
                <FactorRow key={i} claim={claim} factor={f} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-600">No supporting factors identified.</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-red-400">Strongest doubt</h3>
          {negatives.length > 0 ? (
            <ul className="divide-y divide-slate-800/60">
              {negatives.map((f, i) => (
                <FactorRow key={i} claim={claim} factor={f} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-600">No doubting factors identified.</p>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">What would change this?</h3>
        <ul className="mt-2 space-y-1.5">
          {changes.map((c) => (
            <li key={c.kind} className="flex items-start gap-2 text-xs text-slate-500">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-600" aria-hidden />
              {c.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
