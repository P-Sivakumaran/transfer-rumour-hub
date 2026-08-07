'use client'

import { useEffect, useState } from 'react'
import type { ClubDetail } from '@/types'
import RumourCard from './RumourCard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Props {
  club: ClubDetail
}

const POSITION_COLORS: Record<string, string> = {
  GK: '#6366f1', CB: '#8b5cf6', LB: '#a78bfa', RB: '#c4b5fd',
  CDM: '#3b82f6', CM: '#60a5fa', CAM: '#93c5fd',
  LM: '#22d3ee', RM: '#67e8f9',
  LW: '#22c55e', RW: '#4ade80',
  ST: '#f97316', CF: '#fb923c',
}

export default function ClubDashboard({ club }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Incoming fee distribution by position
  const positionData = club.activeIn.reduce<Record<string, number>>((acc, r) => {
    const pos = r.player.position
    const fee = r.reportedFeeMax ?? r.reportedFeeMin ?? 0
    acc[pos] = (acc[pos] ?? 0) + fee * (r.computedLikelihood / 100)
    return acc
  }, {})

  const chartData = Object.entries(positionData)
    .map(([position, value]) => ({ position, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-8">
      {/* Header stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Incoming Rumours', value: club.activeIn.length },
          { label: 'Outgoing Rumours', value: club.activeOut.length },
          { label: 'Squad Size', value: club.players.length },
          { label: 'Expected Spend', value: `€${club.totalExpectedSpend}M` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Spend by position chart */}
      {mounted && chartData.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Expected spend by position (€M)
          </h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <XAxis dataKey="position" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: '#22c55e' }}
                formatter={(v: number) => [`€${v}M`]}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map(({ position }) => (
                  <Cell key={position} fill={POSITION_COLORS[position] ?? '#64748b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Incoming rumours */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
          Incoming ({club.activeIn.length})
        </h3>
        <div className="space-y-2">
          {club.activeIn.map((r) => (
            <RumourCard key={r.id} rumour={r} compact />
          ))}
          {club.activeIn.length === 0 && (
            <p className="text-sm text-slate-500 italic">No active incoming rumours.</p>
          )}
        </div>
      </div>

      {/* Outgoing rumours */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
          Outgoing ({club.activeOut.length})
        </h3>
        <div className="space-y-2">
          {club.activeOut.map((r) => (
            <RumourCard key={r.id} rumour={r} compact />
          ))}
          {club.activeOut.length === 0 && (
            <p className="text-sm text-slate-500 italic">No active outgoing rumours.</p>
          )}
        </div>
      </div>
    </div>
  )
}
