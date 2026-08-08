import { Router } from 'express'
import { PrismaClient, RumourStatus } from '@prisma/client'
import { applyOutcome } from '../ingestion/outcomeDetector.js'
import { enrichQueue, playerSyncQueue } from '../queue/queues.js'
import { broadcast } from '../sse/broadcaster.js'
import { z } from 'zod'

const router = Router()
const prisma = new PrismaClient()

const outcomeSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED', 'DENIED']),
})

// PATCH /admin/rumours/:id/outcome — manually set transfer outcome
router.patch('/rumours/:id/outcome', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return }

  const parsed = outcomeSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid body', details: parsed.error.errors }); return }

  await applyOutcome(id, parsed.data.status, prisma, true)

  const rumour = await prisma.rumour.findUnique({ where: { id } })
  broadcast('rumour:updated', { id, status: parsed.data.status, computedLikelihood: rumour?.computedLikelihood })

  res.json({ id, status: parsed.data.status })
})

// GET /admin/sources — list sources with reliability stats
router.get('/sources', async (_req, res) => {
  const sources = await prisma.source.findMany({
    orderBy: { reliabilityScore: 'desc' },
    select: {
      id: true, name: true, type: true, reliabilityScore: true,
      hitCount: true, missCount: true, country: true, url: true,
      _count: { select: { rumours: true } },
    },
  })
  res.json(sources)
})

// POST /admin/players/:id/enrich — trigger manual Wikidata enrichment
router.post('/players/:id/enrich', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return }

  const player = await prisma.player.findUnique({ where: { id }, select: { name: true } })
  if (!player) { res.status(404).json({ error: 'Player not found' }); return }

  await enrichQueue.add('enrich', { playerId: id, playerName: player.name })
  res.json({ queued: true, playerId: id, playerName: player.name })
})

// POST /admin/players/sync — trigger a Sportmonks squad sync on demand
// (testing without waiting for the daily schedule)
router.post('/players/sync', async (_req, res) => {
  const job = await playerSyncQueue.add('player-sync-manual', {})
  res.json({ queued: true, jobId: job.id })
})

// GET /admin/rumours?status=PENDING — list rumours filtered by status (for review)
// Evidence (the source articles) is attached to each row so a status change
// is always made against visible source text, not a bare likelihood number.
router.get('/rumours', async (req, res) => {
  const status = req.query.status as RumourStatus | undefined
  const where = status && Object.values(RumourStatus).includes(status) ? { status } : {}
  const rumours = await prisma.rumour.findMany({
    where,
    orderBy: { computedLikelihood: 'desc' },
    take: 50,
    include: {
      player: { select: { name: true } },
      fromClub: { select: { name: true } },
      toClub: { select: { name: true } },
      source: { select: { name: true, reliabilityScore: true } },
    },
  })

  const rumourIds = rumours.map((r) => r.id)
  const evidenceRows = rumourIds.length
    ? await prisma.rawSignal.findMany({
        where: { rumourId: { in: rumourIds } },
        orderBy: { publishedAt: 'desc' },
        select: { rumourId: true, sourceName: true, headline: true, link: true, publishedAt: true },
      })
    : []

  const evidenceByRumour = new Map<number, typeof evidenceRows>()
  for (const row of evidenceRows) {
    const list = evidenceByRumour.get(row.rumourId!) ?? []
    list.push(row)
    evidenceByRumour.set(row.rumourId!, list)
  }

  res.json(rumours.map((r) => ({ ...r, evidence: evidenceByRumour.get(r.id) ?? [] })))
})

export default router
