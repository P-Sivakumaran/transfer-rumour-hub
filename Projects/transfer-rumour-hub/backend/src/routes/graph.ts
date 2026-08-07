/**
 * GET /graph — returns nodes + edges for the Sigma.js transfer network.
 *
 * Nodes: players (circle) + clubs (square)
 * Edges: rumours (weight = computedLikelihood / 100, color = status)
 */
import { Router, type Request, type Response } from 'express'
import { PrismaClient, RumourStatus } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

const STATUS_COLORS: Record<RumourStatus, string> = {
  HOT: '#f97316',
  PENDING: '#94a3b8',
  COMPLETED: '#22c55e',
  FAILED: '#ef4444',
  DENIED: '#6b7280',
}

router.get('/', async (_req: Request, res: Response) => {
  const rumours = await prisma.rumour.findMany({
    where: { status: { in: [RumourStatus.PENDING, RumourStatus.HOT, RumourStatus.COMPLETED] } },
    include: { player: true, fromClub: true, toClub: true, source: true },
    orderBy: { computedLikelihood: 'desc' },
    take: 200,
  })

  const nodesMap = new Map<string, object>()
  const edges: object[] = []

  for (const r of rumours) {
    const playerKey = `player-${r.playerId}`
    const fromKey = `club-${r.fromClubId}`
    const toKey = `club-${r.toClubId}`

    if (!nodesMap.has(playerKey)) {
      nodesMap.set(playerKey, {
        id: playerKey,
        label: r.player.name,
        type: 'player',
        position: r.player.position,
        marketValue: r.player.marketValue,
        size: Math.max(6, Math.min(18, (r.player.marketValue ?? 20) / 8)),
        color: '#60a5fa',
        x: Math.random() * 800,
        y: Math.random() * 600,
      })
    }

    if (!nodesMap.has(fromKey)) {
      nodesMap.set(fromKey, {
        id: fromKey,
        label: r.fromClub.shortName ?? r.fromClub.name,
        fullName: r.fromClub.name,
        type: 'club',
        league: r.fromClub.league,
        country: r.fromClub.country,
        size: 14,
        color: '#8b5cf6',
        x: Math.random() * 800,
        y: Math.random() * 600,
      })
    }

    if (!nodesMap.has(toKey)) {
      nodesMap.set(toKey, {
        id: toKey,
        label: r.toClub.shortName ?? r.toClub.name,
        fullName: r.toClub.name,
        type: 'club',
        league: r.toClub.league,
        country: r.toClub.country,
        size: 14,
        color: '#8b5cf6',
        x: Math.random() * 800,
        y: Math.random() * 600,
      })
    }

    edges.push({
      id: `edge-${r.id}`,
      source: fromKey,
      target: playerKey,
      type: 'rumour-from',
      rumourId: r.id,
      weight: r.computedLikelihood / 100,
      color: STATUS_COLORS[r.status],
      size: Math.max(1, r.computedLikelihood / 25),
      label: `${r.player.name} (${Math.round(r.computedLikelihood)}%)`,
      status: r.status,
      likelihood: r.computedLikelihood,
    })

    edges.push({
      id: `edge-${r.id}-to`,
      source: playerKey,
      target: toKey,
      type: 'rumour-to',
      rumourId: r.id,
      weight: r.computedLikelihood / 100,
      color: STATUS_COLORS[r.status],
      size: Math.max(1, r.computedLikelihood / 25),
      status: r.status,
      likelihood: r.computedLikelihood,
    })
  }

  res.json({
    nodes: Array.from(nodesMap.values()),
    edges,
    meta: { nodeCount: nodesMap.size, edgeCount: edges.length },
  })
})

export default router
