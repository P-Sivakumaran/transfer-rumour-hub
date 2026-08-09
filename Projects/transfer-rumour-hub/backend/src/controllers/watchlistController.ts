import type { Response } from 'express'
import { z } from 'zod'
import { listWatchlist, addToWatchlist, removeFromWatchlist } from '../services/watchlistService.js'
import type { AuthedRequest } from '../middleware/auth.js'

const AddSchema = z.object({ playerId: z.coerce.number().int() })

export async function handleListWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  const items = await listWatchlist(req.userId!)
  res.json(items)
}

export async function handleAddWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  const { playerId } = AddSchema.parse(req.body)
  const item = await addToWatchlist(req.userId!, playerId)
  res.status(201).json(item)
}

export async function handleRemoveWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  const playerId = parseInt(req.params.playerId, 10)
  if (isNaN(playerId)) {
    res.status(400).json({ error: 'Invalid playerId' })
    return
  }
  await removeFromWatchlist(req.userId!, playerId)
  res.status(204).end()
}
