'use client'

import { useEffect, useState } from 'react'
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts'
import type { RumourStatus } from '@/types'

interface Props {
  score: number // 0–100
  status: RumourStatus
  size?: 'sm' | 'md' | 'lg'
}

const STATUS_COLORS: Record<RumourStatus, string> = {
  HOT: '#f97316',
  PENDING: '#94a3b8',
  COMPLETED: '#22c55e',
  FAILED: '#ef4444',
  DENIED: '#6b7280',
}

const STATUS_LABELS: Record<RumourStatus, string> = {
  HOT: 'HOT',
  PENDING: 'PENDING',
  COMPLETED: 'DONE',
  FAILED: 'FAILED',
  DENIED: 'DENIED',
}

const SIZES = {
  sm: { outer: 56, inner: 60, fontSize: 11 },
  md: { outer: 90, inner: 65, fontSize: 18 },
  lg: { outer: 130, inner: 70, fontSize: 26 },
}

export default function TruthMeter({ score, status, size = 'md' }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const { outer, inner, fontSize } = SIZES[size]
  const color = STATUS_COLORS[status]
  const data = [{ value: score, fill: color }]

  // SSR placeholder — same dimensions, no chart, avoids hydration mismatch
  if (!mounted) {
    return (
      <div className="relative flex flex-col items-center" style={{ width: outer, height: outer }}>
        <div className="absolute inset-0 rounded-full bg-slate-800" style={{ margin: 4 }} />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" style={{ fontSize }}>
          <span className="font-bold tabular-nums leading-none" style={{ color }}>{score}</span>
          {size !== 'sm' && (
            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
              {STATUS_LABELS[status]}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col items-center">
      <RadialBarChart
        width={outer}
        height={outer}
        cx={outer / 2}
        cy={outer / 2}
        innerRadius={inner / 2}
        outerRadius={outer / 2 - 4}
        data={data}
        startAngle={90}
        endAngle={-270}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
        <RadialBar background={{ fill: '#1e293b' }} dataKey="value" angleAxisId={0} cornerRadius={4} />
      </RadialBarChart>
      {/* Center label */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        style={{ fontSize }}
      >
        <span className="font-bold tabular-nums leading-none" style={{ color }}>
          {score}
        </span>
        {size !== 'sm' && (
          <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
            {STATUS_LABELS[status]}
          </span>
        )}
      </div>
    </div>
  )
}
