'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { RumourHistoryPoint } from '@/types'

interface Props {
  history: RumourHistoryPoint[]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function TimelineChart({ history }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!mounted) return <div className="h-[180px] animate-pulse rounded-lg bg-slate-800/60" />

  if (history.length < 2) {
    return <p className="text-sm text-slate-500 italic">Not enough data for timeline.</p>
  }

  const data = history.map((h) => ({
    date: formatDate(h.recordedAt),
    likelihood: Math.round(h.computedLikelihood),
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="date"
          tick={{ fill: '#64748b', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: '#64748b', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip
          contentStyle={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: '#94a3b8' }}
          itemStyle={{ color: '#22c55e' }}
          formatter={(v: number) => [`${v}%`, 'Likelihood']}
        />
        <ReferenceLine y={70} stroke="#f97316" strokeDasharray="4 2" strokeOpacity={0.5} />
        <Line
          type="monotone"
          dataKey="likelihood"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#22c55e', strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
