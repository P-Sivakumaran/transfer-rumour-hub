'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { clsx } from 'clsx'

interface GraphNode {
  id: string
  label: string
  type: 'player' | 'club'
  size: number
  color: string
  x: number
  y: number
  position?: string
  league?: string
  marketValue?: number
  likelihood?: number
}

interface GraphEdge {
  id: string
  source: string
  target: string
  color: string
  size: number
  weight: number
  status: string
  likelihood: number
  rumourId?: number
  label?: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  meta: { nodeCount: number; edgeCount: number }
}

interface HoveredNode {
  label: string
  type: string
  position?: string
  league?: string
  marketValue?: number
}

const STATUS_LEGEND = [
  { label: 'HOT (≥70%)', color: '#f97316' },
  { label: 'PENDING', color: '#94a3b8' },
  { label: 'COMPLETED', color: '#22c55e' },
  { label: 'FAILED', color: '#ef4444' },
]

export default function TransferGraph() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<HoveredNode | null>(null)
  const [filter, setFilter] = useState<'all' | 'HOT' | 'PENDING' | 'COMPLETED'>('all')
  const [running, setRunning] = useState(true)

  // Fetch graph data
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/graph`)
      .then((r) => r.json())
      .then((d: GraphData) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Build and render graph
  useEffect(() => {
    if (!data || !containerRef.current) return

    const graph = new Graph({ multi: true, type: 'directed' })
    graphRef.current = graph

    // Add nodes — Sigma v3 uses 'circle' as default node type; no custom types needed
    for (const node of data.nodes) {
      graph.addNode(node.id, {
        label: node.label,
        x: node.x,
        y: node.y,
        size: node.size,
        color: node.color,
        nodeType: node.type,   // stored as data attr, not Sigma type
        position: node.position,
        league: node.league,
        marketValue: node.marketValue,
      })
    }

    // Add edges (filtered by status if needed)
    for (const edge of data.edges) {
      const visible = filter === 'all' || edge.status === filter
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        color: visible ? edge.color : '#1e293b',
        size: visible ? edge.size : 0.5,
        weight: edge.weight,
        status: edge.status,
        likelihood: edge.likelihood,
        rumourId: edge.rumourId,
        label: edge.label,
        hidden: !visible,
      })
    }

    // Run ForceAtlas2 layout (non-blocking, limited iterations)
    forceAtlas2.assign(graph, {
      iterations: 100,
      settings: {
        gravity: 1,
        scalingRatio: 10,
        strongGravityMode: false,
        barnesHutOptimize: true,
      },
    })

    // Init Sigma
    let sigma: Sigma
    try {
    sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      labelFont: 'Inter, sans-serif',
      labelSize: 11,
      labelWeight: '600',
      labelColor: { color: '#94a3b8' },
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
    })
    } catch (e) {
      setInitError(String(e))
      return
    }
    sigmaRef.current = sigma

    // Hover events
    sigma.on('enterNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node)
      setHovered({
        label: attrs.label,
        type: attrs.nodeType,
        position: attrs.position,
        league: attrs.league,
        marketValue: attrs.marketValue,
      })
      // Highlight connected edges
      graph.edges(node).forEach((e) => {
        graph.setEdgeAttribute(e, 'size', graph.getEdgeAttribute(e, 'size') * 2)
      })
      sigma.refresh()
    })

    sigma.on('leaveNode', ({ node }) => {
      setHovered(null)
      graph.edges(node).forEach((e) => {
        graph.setEdgeAttribute(e, 'size', graph.getEdgeAttribute(e, 'size') / 2)
      })
      sigma.refresh()
    })

    return () => {
      sigmaRef.current?.kill()
      sigmaRef.current = null
    }
  }, [data, filter])

  const toggleLayout = useCallback(() => {
    if (!graphRef.current || !sigmaRef.current) return
    if (running) {
      setRunning(false)
    } else {
      forceAtlas2.assign(graphRef.current, { iterations: 50 })
      sigmaRef.current.refresh()
      setRunning(true)
    }
  }, [running])

  if (initError) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-6 text-sm">
        <p className="font-semibold text-red-400 mb-2">Graph init error</p>
        <pre className="text-red-300/70 text-xs overflow-auto">{initError}</pre>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-pitch-500 border-t-transparent" />
          <p className="text-sm text-slate-500">Building transfer network...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {(['all', 'HOT', 'PENDING', 'COMPLETED'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                filter === f
                  ? 'border-pitch-500 bg-pitch-500/20 text-pitch-500'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500',
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-3 text-xs text-slate-500">
          {STATUS_LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Graph canvas */}
      <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        <div ref={containerRef} className="h-[640px] w-full" />

        {/* Node type legend */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs backdrop-blur">
          <span className="flex items-center gap-2 text-slate-400">
            <span className="h-3 w-3 rounded-full bg-[#60a5fa]" /> Player
          </span>
          <span className="flex items-center gap-2 text-slate-400">
            <span className="h-3 w-3 rounded-sm bg-[#8b5cf6]" /> Club
          </span>
        </div>

        {/* Stats */}
        {data && (
          <div className="absolute bottom-4 right-4 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-400 backdrop-blur">
            {data.meta.nodeCount} nodes · {Math.round(data.meta.edgeCount / 2)} rumours
          </div>
        )}

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute left-4 top-4 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-sm backdrop-blur">
            <p className="font-semibold text-white">{hovered.label}</p>
            <p className="text-xs text-slate-400 capitalize">{hovered.type}</p>
            {hovered.position && <p className="text-xs text-slate-500">Position: {hovered.position}</p>}
            {hovered.league && <p className="text-xs text-slate-500">{hovered.league}</p>}
            {hovered.marketValue && (
              <p className="text-xs text-pitch-500 font-mono">€{hovered.marketValue}M</p>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-600">Scroll to zoom · drag to pan · hover nodes for detail</p>
    </div>
  )
}
