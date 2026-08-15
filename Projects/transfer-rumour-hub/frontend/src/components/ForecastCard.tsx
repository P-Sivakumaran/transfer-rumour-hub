'use client'

import type { ForecastDisplayData } from '@/types'
import { CheckCircleIcon, AlertTriangleIcon, HelpCircleIcon, XCircleIcon } from './icons'
import { clsx } from 'clsx'

interface Props {
  forecast: ForecastDisplayData | null
  isLoading?: boolean
  error?: string | null
}

function formatAsOf(iso?: string): string {
  if (!iso) return 'unknown time'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

const DISCLAIMER = 'Forecast, not confirmation.'

function CardShell({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"
    >
      {children}
    </div>
  )
}

export default function ForecastCard({ forecast, isLoading = false, error = null }: Props) {
  if (isLoading) {
    return (
      <CardShell testId="forecast-card-loading">
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-32 rounded bg-slate-800" />
          <div className="h-10 w-24 rounded bg-slate-800" />
          <div className="h-3 w-48 rounded bg-slate-800" />
        </div>
      </CardShell>
    )
  }

  if (error) {
    return (
      <CardShell testId="forecast-card-error">
        <div className="flex items-start gap-3">
          <XCircleIcon className="mt-0.5 h-6 w-6 flex-shrink-0 text-slate-500" />
          <div>
            <p className="text-sm font-semibold text-slate-300">Forecast unavailable</p>
            <p className="mt-1 text-xs text-slate-500">{error}</p>
          </div>
        </div>
      </CardShell>
    )
  }

  if (!forecast || forecast.displayMode === 'INSUFFICIENT_DATA') {
    return (
      <CardShell testId="forecast-card-insufficient">
        <div className="flex items-start gap-3">
          <HelpCircleIcon className="mt-0.5 h-6 w-6 flex-shrink-0 text-slate-500" />
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Insufficient historical data
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {forecast?.insufficientDataReason ??
                'Not enough resolved outcomes exist yet to show a calibrated probability.'}
            </p>
            <p className="mt-3 text-[11px] font-medium uppercase tracking-widest text-slate-600">
              {DISCLAIMER}
            </p>
          </div>
        </div>
      </CardShell>
    )
  }

  const isInterval = forecast.displayMode === 'INTERVAL'
  const low = forecast.uncertaintyLow
  const high = forecast.uncertaintyHigh
  const point = forecast.calibratedProbability

  return (
    <CardShell testId={isInterval ? 'forecast-card-interval' : 'forecast-card-precise'}>
      <div className="flex items-start gap-3">
        {isInterval ? (
          <AlertTriangleIcon className="mt-1 h-6 w-6 flex-shrink-0 text-amber-400" />
        ) : (
          <CheckCircleIcon className="mt-1 h-6 w-6 flex-shrink-0 text-pitch-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {isInterval ? 'Wide-uncertainty forecast' : 'Completion likelihood'}
          </p>

          {isInterval ? (
            <p className="mt-1 text-3xl font-bold tabular-nums text-white">
              {low != null && high != null ? `${pct(low)}–${pct(high)}` : '—'}
            </p>
          ) : (
            <div className="mt-1 flex items-baseline gap-2">
              <span className={clsx('text-4xl font-bold tabular-nums', 'text-pitch-500')}>
                {point != null ? pct(point) : '—'}
              </span>
              {low != null && high != null && (
                <span className="text-sm text-slate-500">
                  ({pct(low)}–{pct(high)} band)
                </span>
              )}
            </div>
          )}

          <p className="mt-1 text-xs text-slate-500">
            {isInterval
              ? 'The uncertainty band is too wide to show a single number responsibly.'
              : 'Chance of an official club confirmation within the forecast window.'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
            <span>As of {formatAsOf(forecast.predictionTimestamp)}</span>
            {forecast.modelVersion && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{forecast.modelVersion}</span>
              </>
            )}
          </div>

          <p className="mt-3 text-[11px] font-medium uppercase tracking-widest text-slate-600">
            {DISCLAIMER}
          </p>
        </div>
      </div>
    </CardShell>
  )
}
