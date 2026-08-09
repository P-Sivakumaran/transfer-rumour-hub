import type { Response } from 'express'
import { z } from 'zod'
import { listRumours, getRumourById, getRumourHistory, getRumourEvidence } from '../services/rumoursService.js'
import { getWatchlistPlayerIds } from '../services/watchlistService.js'
import { RumourStatus } from '@prisma/client'
import type { AuthedRequest } from '../middleware/auth.js'

const ListQuerySchema = z.object({
  league: z.string().optional(),
  clubId: z.coerce.number().optional(),
  position: z.string().optional(),
  status: z.nativeEnum(RumourStatus).optional(),
  window: z.enum(['SUMMER', 'WINTER', 'FREE_AGENT']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  watchlist: z.coerce.boolean().optional(),
})

export async function handleListRumours(req: AuthedRequest, res: Response): Promise<void> {
  const { watchlist, ...query } = ListQuerySchema.parse(req.query)

  let playerIds: number[] | undefined
  if (watchlist) {
    if (!req.userId) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    playerIds = await getWatchlistPlayerIds(req.userId)
  }

  const result = await listRumours({ ...query, playerIds })
  res.json(result)
}

export async function handleGetRumour(req: AuthedRequest, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10)
  const rumour = await getRumourById(id)
  if (!rumour) {
    res.status(404).json({ error: 'Rumour not found' })
    return
  }
  const [history, evidence] = await Promise.all([getRumourHistory(id), getRumourEvidence(id)])
  res.json({ ...rumour, history, evidence })
}
