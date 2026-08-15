/**
 * Pure graph-model + layout for ProvenanceGraph. Deliberately NOT built on
 * Sigma/graphology (used by the existing TransferGraph.tsx, network/
 * network route) — Sigma renders to canvas, which has no real DOM nodes to
 * focus/label, and this component's own requirements (keyboard navigation,
 * accessible labels) aren't satisfiable on a canvas without building a
 * parallel accessibility layer from scratch. A plain SVG/DOM graph with
 * real <button> nodes gets keyboard nav and labels for free from the
 * platform. Layout is a deterministic radial placement, not a physics
 * simulation — appropriate for a progressive-disclosure investigation view
 * with at most a few dozen nodes, not a full transfer-market network.
 */
import type { ClaimDetail, EvidenceItemData } from '@/types'
import { isRoot } from './evidenceCategories'

export type GraphNodeType = 'claim' | 'source' | 'evidence' | 'club' | 'player'
export type GraphEdgeType = 'originated' | 'cited' | 'corroborated' | 'denied' | 'confirmed'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  detail?: string
}

export interface GraphEdge {
  id: string
  type: GraphEdgeType
  source: string
  target: string
}

export interface ProvenanceGraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function tierLabel(tier: number | null | undefined): string | undefined {
  if (tier == null) return undefined
  return `Tier ${tier}`
}

export function buildProvenanceGraph(claim: ClaimDetail): ProvenanceGraphData {
  const claimNodeId = `claim-${claim.id}`
  const nodes: GraphNode[] = [
    {
      id: claimNodeId,
      type: 'claim',
      label: `Claim #${claim.id}`,
      detail: claim.claimStatus,
    },
  ]
  const edges: GraphEdge[] = []
  const seenSourceIds = new Set<number>()

  if (claim.player) {
    const playerNodeId = `player-${claim.playerId}`
    nodes.push({ id: playerNodeId, type: 'player', label: claim.player.name, detail: claim.player.position ?? undefined })
    edges.push({ id: `${claimNodeId}->${playerNodeId}`, type: 'originated', source: claimNodeId, target: playerNodeId })
  }
  if (claim.fromClub) {
    const clubNodeId = `club-${claim.fromClub.id}`
    nodes.push({ id: clubNodeId, type: 'club', label: claim.fromClub.shortName ?? claim.fromClub.name, detail: 'From club' })
    edges.push({ id: `${claimNodeId}->${clubNodeId}`, type: 'originated', source: claimNodeId, target: clubNodeId })
  }
  if (claim.toClub) {
    const clubNodeId = `club-${claim.toClub.id}`
    nodes.push({ id: clubNodeId, type: 'club', label: claim.toClub.shortName ?? claim.toClub.name, detail: 'To club' })
    edges.push({ id: `${claimNodeId}->${clubNodeId}`, type: 'originated', source: claimNodeId, target: clubNodeId })
  }

  const allEvidence = claim.provenanceClusters.flatMap((c) => [c.root, ...c.syndicated])

  for (const item of allEvidence) {
    const evidenceNodeId = `evidence-${item.id}`
    nodes.push({
      id: evidenceNodeId,
      type: 'evidence',
      label: item.title,
      detail: `${item.evidenceDirection} · ${new Date(item.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    })

    if (!seenSourceIds.has(item.sourceId)) {
      seenSourceIds.add(item.sourceId)
      nodes.push({
        id: `source-${item.sourceId}`,
        type: 'source',
        label: item.sourceName ?? `Source #${item.sourceId}`,
        detail: tierLabel(item.sourceTier),
      })
    }
    edges.push({
      id: `source-${item.sourceId}->${evidenceNodeId}`,
      type: 'originated',
      source: `source-${item.sourceId}`,
      target: evidenceNodeId,
    })

    if (item.parentEvidenceItemId != null) {
      edges.push({
        id: `${evidenceNodeId}-cited-${item.parentEvidenceItemId}`,
        type: 'cited',
        source: evidenceNodeId,
        target: `evidence-${item.parentEvidenceItemId}`,
      })
    }

    if (item.evidenceDirection === 'DENIES') {
      edges.push({ id: `${evidenceNodeId}->denied->${claimNodeId}`, type: 'denied', source: evidenceNodeId, target: claimNodeId })
    } else if (item.evidenceDirection === 'CONFIRMS' && item.sourceType === 'CLUB_OFFICIAL') {
      edges.push({ id: `${evidenceNodeId}->confirmed->${claimNodeId}`, type: 'confirmed', source: evidenceNodeId, target: claimNodeId })
    } else if (isRoot(item) && (item.evidenceDirection === 'SUPPORTS' || item.evidenceDirection === 'CONFIRMS')) {
      edges.push({ id: `${evidenceNodeId}->corroborated->${claimNodeId}`, type: 'corroborated', source: evidenceNodeId, target: claimNodeId })
    }
  }

  return { nodes, edges }
}

export interface PositionedNode extends GraphNode {
  x: number
  y: number
}

/** Deterministic radial layout: claim centered, everything else placed on
 * a ring by type (structural entities inner, evidence/source outer),
 * evenly spaced by angle. Same input always produces the same output —
 * important for both testability and for not disorienting a keyboard user
 * with a layout that shifts between renders. */
export function radialLayout(graph: ProvenanceGraphData, radius = 200): PositionedNode[] {
  const claimNode = graph.nodes.find((n) => n.type === 'claim')
  const others = graph.nodes.filter((n) => n.type !== 'claim')
  const inner = others.filter((n) => n.type === 'player' || n.type === 'club')
  const outer = others.filter((n) => n.type === 'evidence' || n.type === 'source')

  const positioned: PositionedNode[] = []
  if (claimNode) positioned.push({ ...claimNode, x: 0, y: 0 })

  inner.forEach((node, i) => {
    const angle = (i / Math.max(inner.length, 1)) * 2 * Math.PI
    positioned.push({ ...node, x: Math.cos(angle) * radius * 0.5, y: Math.sin(angle) * radius * 0.5 })
  })
  outer.forEach((node, i) => {
    const angle = (i / Math.max(outer.length, 1)) * 2 * Math.PI
    positioned.push({ ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  })

  return positioned
}

export function neighborsOf(nodeId: string, graph: ProvenanceGraphData): string[] {
  const neighbors = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.source === nodeId) neighbors.add(edge.target)
    if (edge.target === nodeId) neighbors.add(edge.source)
  }
  return Array.from(neighbors)
}

export function accessibleNodeLabel(node: GraphNode): string {
  const typeLabel = { claim: 'Claim', source: 'Source', evidence: 'Evidence item', club: 'Club', player: 'Player' }[node.type]
  return `${typeLabel}: ${node.label}${node.detail ? `, ${node.detail}` : ''}`
}
