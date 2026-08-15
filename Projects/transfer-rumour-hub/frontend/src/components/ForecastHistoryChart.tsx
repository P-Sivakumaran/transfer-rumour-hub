'use client'

import { useEffect, useState } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot,
} from 'recharts'
import type { ClaimDetail, ForecastHistoryPoint, EntitlementDenial } from '@/types'
import { CheckCircleIcon, XCircleIcon } from './icons'
import UpgradePrompt from './UpgradePrompt'

interface Props {
  history: ForecastHistoryPoint[] | null
  claim?: ClaimDetail | null
  isLoading?: boolean
  error?: string | null
  entitlementDenied?: EntitlementDenial | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

interface ChartRow {
  timestamp: number
  date: string
  probability: number | null
  low: number | null
  high: number | null
}

export default function ForecastHistoryChart({
  history,
  claim,
  isLoading = false,
  error = null,
  entitlementDenied = null,
}: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="history-loading">
        <div className="h-[180px] animate-pulse rounded-lg bg-slate-800/60" />
      </div>
    )
  }

  if (entitlementDenied) {
    return (
      <div className="space-y-2" data-testid="history-entitlement-denied">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Forecast history</p>
        <UpgradePrompt
          description="Full forecast history and the probability-change timeline are part of Supporter/Pro."
          requiredTier={entitlementDenied.requiredTier}
          featureKey="FORECAST_HISTORY"
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="history-error">
        <p className="text-sm text-slate-500">Couldn&apos;t load forecast history: {error}</p>
      </div>
    )
  }

  const precise = (history ?? []).filter((h) => h.calibratedProbability != null)

  if (!history || precise.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="history-empty">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Forecast history</p>
        <p className="mt-2 text-sm text-slate-500">
          This claim doesn&apos;t have any historical forecasts yet — a calibrated probability hasn&apos;t been
          computed for it.
        </p>
      </div>
    )
  }

  const data: ChartRow[] = precise.map((h) => ({
    timestamp: new Date(h.predictionTimestamp).getTime(),
    date: formatDate(h.predictionTimestamp),
    probability: Math.round((h.calibratedProbability ?? 0) * 100),
    low: h.uncertaintyLow != null ? Math.round(h.uncertaintyLow * 100) : null,
    high: h.uncertaintyHigh != null ? Math.round(h.uncertaintyHigh * 100) : null,
  }))
  const hasBand = data.some((d) => d.low != null && d.high != null)

  const confirmationTs = claim?.officialConfirmation ? new Date(claim.officialConfirmation.publishedAt).getTime() : null
  const denialTs = claim?.officialDenial ? new Date(claim.officialDenial.publishedAt).getTime() : null

  const confirmationRow = confirmationTs != null ? nearestRow(data, confirmationTs) : null
  const denialRow = denialTs != null ? nearestRow(data, denialTs) : null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="forecast-history-chart">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Forecast history</p>

      {!mounted ? (
        <div className="h-[180px] animate-pulse rounded-lg bg-slate-800/60" />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(v: number, name: string) => [`${v}%`, name === 'probability' ? 'Probability' : name]}
            />
            {hasBand && (
              <Area
                type="monotone"
                dataKey="high"
                stroke="none"
                fill="#22c55e"
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            )}
            {hasBand && (
              <Area
                type="monotone"
                dataKey="low"
                stroke="none"
                fill="#0f172a"
                fillOpacity={1}
                isAnimationActive={false}
              />
            )}
            <Line type="monotone" dataKey="probability" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
            {confirmationRow && (
              <ReferenceDot
                x={confirmationRow.date}
                y={confirmationRow.probability ?? 0}
                r={6}
                fill="#22c55e"
                stroke="#0f172a"
                strokeWidth={2}
              />
            )}
            {denialRow && (
              <ReferenceDot
                x={denialRow.date}
                y={denialRow.probability ?? 0}
                r={6}
                fill="#ef4444"
                stroke="#0f172a"
                strokeWidth={2}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {(confirmationRow || denialRow) && (
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
          {confirmationRow && (
            <span className="flex items-center gap-1.5">
              <CheckCircleIcon className="h-3.5 w-3.5 text-pitch-500" /> Official confirmation
            </span>
          )}
          {denialRow && (
            <span className="flex items-center gap-1.5">
              <XCircleIcon className="h-3.5 w-3.5 text-red-400" /> Official denial
            </span>
          )}
        </div>
      )}
      {hasBand && <p className="mt-1 text-[11px] text-slate-600">Shaded band = uncertainty range</p>}
    </div>
  )
}

function nearestRow(data: ChartRow[], targetTs: number): ChartRow | null {
  if (data.length === 0) return null
  return data.reduce((closest, row) =>
    Math.abs(row.timestamp - targetTs) < Math.abs(closest.timestamp - targetTs) ? row : closest,
  )
}
