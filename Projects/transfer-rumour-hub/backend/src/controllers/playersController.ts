import type { Request, Response } from 'express'
import { getPlayerById, searchPlayers } from '../services/playersService.js'

export async function handleGetPlayer(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10)
  const player = await getPlayerById(id)
  if (!player) {
    res.status(404).json({ error: 'Player not found' })
    return
  }
  res.json(player)
}

export async function handleSearchPlayers(req: Request, res: Response): Promise<void> {
  const q = (req.query.q as string) ?? ''
  const players = await searchPlayers(q)
  res.json(players)
}
