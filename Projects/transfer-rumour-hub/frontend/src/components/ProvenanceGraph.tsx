'use client'

import { useMemo, useRef, useState } from 'react'
import type { ClaimDetail } from '@/types'
import {
  buildProvenanceGraph, radialLayout, neighborsOf, accessibleNodeLabel,
  type PositionedNode, type GraphEdgeType,
} from '@/lib/provenanceGraph'
import { clsx } from 'clsx'
import { api } from '@/lib/api'

interface Props {
  claim: ClaimDetail | null
  isLoading?: boolean
  error?: string | null
}

const NODE_COLORS: Record<PositionedNode['type'], string> = {
  claim: 'border-pitch-500 bg-pitch-500/10',
  player: 'border-blue-500 bg-blue-500/10',
  club: 'border-purple-500 bg-purple-500/10',
  source: 'border-amber-500 bg-amber-500/10',
  evidence: 'border-slate-500 bg-slate-800/60',
}

const EDGE_LABELS: Record<GraphEdgeType, string> = {
  originated: 'originated',
  cited: 'cited',
  corroborated: 'corroborated',
  denied: 'denied',
  confirmed: 'confirmed',
}

function ZoomControls({ zoom, onZoom, onReset }: { zoom: number; onZoom: (delta: number) => void; onReset: () => void }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Graph zoom controls">
      <button
        type="button"
        onClick={() => onZoom(-0.2)}
        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
        aria-label="Zoom out"
      >
        −
      </button>
      <span className="w-10 text-center text-xs text-slate-500 tabular-nums">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        onClick={() => onZoom(0.2)}
        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        onClick={onReset}
        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
        aria-label="Reset zoom"
      >
        Reset
      </button>
    </div>
  )
}

function GraphAsList({ claim }: { claim: ClaimDetail }) {
  const graph = useMemo(() => buildProvenanceGraph(claim), [claim])
  return (
    <ul className="space-y-2" data-testid="provenance-list-view">
      {graph.nodes.map((node) => {
        const edgesOut = graph.edges.filter((e) => e.source === node.id)
        return (
          <li key={node.id} className={clsx('rounded-lg border p-2.5', NODE_COLORS[node.type])}>
            <p className="text-xs font-semibold text-slate-200">{accessibleNodeLabel(node)}</p>
            {edgesOut.length > 0 && (
              <ul className="mt-1 space-y-0.5 pl-3 text-[11px] text-slate-500">
                {edgesOut.map((e) => {
                  const target = graph.nodes.find((n) => n.id === e.target)
                  return (
                    <li key={e.id}>
                      {EDGE_LABELS[e.type]} → {target ? accessibleNodeLabel(target) : e.target}
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function SvgGraph({ claim }: { claim: ClaimDetail }) {
  const graph = useMemo(() => buildProvenanceGraph(claim), [claim])
  const positioned = useMemo(() => radialLayout(graph), [graph])
  const [zoom, setZoom] = useState(1)
  const [focusedId, setFocusedId] = useState<string | null>(positioned[0]?.id ?? null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())

  const size = 480
  const center = size / 2

  const moveFocus = (fromId: string, dir: 1 | -1) => {
    const neighbors = neighborsOf(fromId, graph)
    if (neighbors.length === 0) return
    const idx = neighbors.indexOf(focusedId ?? '')
    const nextId = idx === -1 ? neighbors[0] : neighbors[(idx + dir + neighbors.length) % neighbors.length]
    setFocusedId(nextId)
    buttonRefs.current.get(nextId)?.focus()
  }

  const selectedNode = positioned.find((n) => n.id === selectedId) ?? null
  const selectedNeighbors = selectedId ? neighborsOf(selectedId, graph) : []

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-600">Arrow keys move between connected nodes · Enter selects</p>
        <ZoomControls zoom={zoom} onZoom={(d) => setZoom((z) => Math.min(2, Math.max(0.5, z + d)))} onReset={() => setZoom(1)} />
      </div>
      <div
        className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
        style={{ height: 340 }}
        data-testid="provenance-svg-view"
      >
        <div
          className="absolute left-1/2 top-1/2 origin-center"
          style={{ transform: `translate(-50%, -50%) scale(${zoom})`, width: size, height: size }}
        >
          <svg width={size} height={size} className="absolute inset-0" aria-hidden>
            {graph.edges.map((e) => {
              const s = positioned.find((n) => n.id === e.source)
              const t = positioned.find((n) => n.id === e.target)
              if (!s || !t) return null
              const highlighted = selectedId != null && (e.source === selectedId || e.target === selectedId)
              return (
                <line
                  key={e.id}
                  x1={center + s.x} y1={center + s.y}
                  x2={center + t.x} y2={center + t.y}
                  stroke={highlighted ? '#22c55e' : '#334155'}
                  strokeWidth={highlighted ? 2 : 1}
                />
              )
            })}
          </svg>
          {positioned.map((node) => (
            <button
              key={node.id}
              ref={(el) => {
                if (el) buttonRefs.current.set(node.id, el)
              }}
              type="button"
              aria-label={accessibleNodeLabel(node)}
              aria-pressed={selectedId === node.id}
              tabIndex={focusedId === node.id || (focusedId === null && node.id === positioned[0]?.id) ? 0 : -1}
              onFocus={() => setFocusedId(node.id)}
              onClick={() => setSelectedId((prev) => (prev === node.id ? null : node.id))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(node.id, 1) }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(node.id, -1) }
                if (e.key === 'Escape') { setSelectedId(null) }
              }}
              className={clsx(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-[10px] font-medium text-slate-200 shadow',
                'max-w-[110px] truncate focus:outline-none focus:ring-2 focus:ring-pitch-500',
                NODE_COLORS[node.type],
                selectedId === node.id && 'ring-2 ring-pitch-500',
              )}
              style={{ left: center + node.x, top: center + node.y }}
            >
              {node.label}
            </button>
          ))}
        </div>
      </div>

      {selectedNode && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs" role="status">
          <p className="font-semibold text-slate-200">{accessibleNodeLabel(selectedNode)}</p>
          <p className="mt-1 text-slate-500">{selectedNeighbors.length} connected node{selectedNeighbors.length !== 1 ? 's' : ''}</p>
        </div>
      )}
    </div>
  )
}

export default function ProvenanceGraph({ claim, isLoading = false, error = null }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [forceListView, setForceListView] = useState(false)

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="provenance-loading">
        <div className="h-6 w-56 animate-pulse rounded bg-slate-800" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="provenance-error">
        <p className="text-sm text-slate-500">Couldn&apos;t load the provenance graph: {error}</p>
      </div>
    )
  }

  if (!claim) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="provenance-empty">
        <p className="text-sm text-slate-500">No claim data available.</p>
      </div>
    )
  }

  if (!expanded) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="provenance-collapsed">
        <button
          type="button"
          onClick={() => {
            setExpanded(true)
            // Aggregate usage only — no claimId here, deliberately. See
            // docs/monetisation-proposal.md "Privacy and data-licensing
            // considerations".
            api.analytics.logEvent('PROVENANCE_PANEL_VIEWED')
          }}
          className="flex w-full items-center justify-between text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-slate-200">Investigate provenance graph</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              See how sources, evidence, and this claim connect — for deeper investigation, not casual reading.
            </span>
          </span>
          <span aria-hidden className="ml-3 text-slate-500">▸</span>
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="provenance-expanded">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => setExpanded(false)} className="text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-300">
          ▾ Provenance graph
        </button>
        <button
          type="button"
          onClick={() => setForceListView((v) => !v)}
          className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
        >
          {forceListView ? 'View as graph' : 'View as list'}
        </button>
      </div>

      {forceListView ? (
        <GraphAsList claim={claim} />
      ) : (
        <>
          <div className="hidden sm:block">
            <SvgGraph claim={claim} />
          </div>
          <div className="sm:hidden" aria-label="Compact mobile view">
            <GraphAsList claim={claim} />
          </div>
        </>
      )}
    </div>
  )
}
