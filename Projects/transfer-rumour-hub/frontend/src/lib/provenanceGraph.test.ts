import { describe, it, expect } from 'vitest'
import { buildProvenanceGraph, radialLayout, neighborsOf, accessibleNodeLabel } from './provenanceGraph'
import { gyokeresClaimDetail, davidClaimDetail } from '@/test/fixtures'

describe('buildProvenanceGraph — node types', () => {
  it('includes exactly one claim node, one player node, and both club nodes', () => {
    const { nodes } = buildProvenanceGraph(gyokeresClaimDetail)
    expect(nodes.filter((n) => n.type === 'claim')).toHaveLength(1)
    expect(nodes.filter((n) => n.type === 'player')).toHaveLength(1)
    expect(nodes.filter((n) => n.type === 'club')).toHaveLength(2)
  })

  it('creates one source node per distinct source, not per evidence item', () => {
    const { nodes } = buildProvenanceGraph(gyokeresClaimDetail)
    // 6 evidence items, 6 distinct sources in the fixture
    expect(nodes.filter((n) => n.type === 'evidence')).toHaveLength(6)
    expect(nodes.filter((n) => n.type === 'source')).toHaveLength(6)
  })
})

describe('buildProvenanceGraph — edge types', () => {
  it('links each evidence item to its source via an "originated" edge', () => {
    const { edges } = buildProvenanceGraph(gyokeresClaimDetail)
    const originated = edges.filter((e) => e.type === 'originated' && e.target === 'evidence-1')
    expect(originated).toHaveLength(1)
    expect(originated[0].source).toBe('source-1')
  })

  it('links a syndicated item to its attributed parent via a "cited" edge', () => {
    const { edges } = buildProvenanceGraph(gyokeresClaimDetail)
    const cited = edges.find((e) => e.type === 'cited' && e.source === 'evidence-2')
    expect(cited?.target).toBe('evidence-1')
  })

  it('links the official confirmation to the claim via a "confirmed" edge', () => {
    const { edges } = buildProvenanceGraph(gyokeresClaimDetail)
    expect(edges.some((e) => e.type === 'confirmed' && e.source === 'evidence-6' && e.target === 'claim-1')).toBe(true)
  })

  it('links the official denial to the claim via a "denied" edge, for the David claim', () => {
    const { edges } = buildProvenanceGraph(davidClaimDetail)
    expect(edges.some((e) => e.type === 'denied' && e.target === 'claim-2')).toBe(true)
    expect(edges.some((e) => e.type === 'confirmed')).toBe(false)
  })

  it('links an independent original report to the claim via a "corroborated" edge', () => {
    const { edges } = buildProvenanceGraph(gyokeresClaimDetail)
    expect(edges.some((e) => e.type === 'corroborated' && e.source === 'evidence-1' && e.target === 'claim-1')).toBe(true)
  })
})

describe('radialLayout', () => {
  it('places the claim node at the origin', () => {
    const graph = buildProvenanceGraph(gyokeresClaimDetail)
    const positioned = radialLayout(graph)
    const claimPos = positioned.find((n) => n.type === 'claim')
    expect(claimPos?.x).toBe(0)
    expect(claimPos?.y).toBe(0)
  })

  it('is deterministic — same input produces identical positions', () => {
    const graph = buildProvenanceGraph(gyokeresClaimDetail)
    const a = radialLayout(graph)
    const b = radialLayout(graph)
    expect(a).toEqual(b)
  })

  it('positions every node from the graph exactly once', () => {
    const graph = buildProvenanceGraph(gyokeresClaimDetail)
    const positioned = radialLayout(graph)
    expect(positioned).toHaveLength(graph.nodes.length)
  })
})

describe('neighborsOf', () => {
  it('finds neighbors regardless of edge direction', () => {
    const graph = buildProvenanceGraph(gyokeresClaimDetail)
    const claimNeighbors = neighborsOf('claim-1', graph)
    expect(claimNeighbors).toContain('evidence-6') // confirmed edge points evidence -> claim
  })
})

describe('accessibleNodeLabel', () => {
  it('produces a type-prefixed, detail-inclusive label', () => {
    const label = accessibleNodeLabel({ id: 'x', type: 'source', label: 'Fabrizio Romano', detail: 'Tier 1' })
    expect(label).toBe('Source: Fabrizio Romano, Tier 1')
  })

  it('omits the detail suffix when there is no detail', () => {
    const label = accessibleNodeLabel({ id: 'x', type: 'claim', label: 'Claim #1' })
    expect(label).toBe('Claim: Claim #1')
  })
})
