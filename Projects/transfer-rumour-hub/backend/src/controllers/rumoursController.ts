import type { Request, Response } from 'express'
import { z } from 'zod'
import { listRumours, getRumourById, getRumourHistory } from '../services/rumoursService.js'
import { RumourStatus } from '@prisma/client'

const ListQuerySchema = z.object({
  league: z.string().optional(),
  clubId: z.coerce.number().optional(),
  position: z.string().optional(),
  status: z.nativeEnum(RumourStatus).optional(),
  window: z.enum(['SUMMER', 'WINTER', 'FREE_AGENT']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
})

export async function handleListRumours(req: Request, res: Response): Promise<void> {
  const query = ListQuerySchema.parse(req.query)
  const result = await listRumours(query)
  res.json(result)
}

export async function handleGetRumour(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10)
  const rumour = await getRumourById(id)
  if (!rumour) {
    res.status(404).json({ error: 'Rumour not found' })
    return
  }
  const history = await getRumourHistory(id)
  res.json({ ...rumour, history })
}
