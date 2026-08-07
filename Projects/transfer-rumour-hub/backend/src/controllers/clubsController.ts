import type { Request, Response } from 'express'
import { getClubById, listClubs } from '../services/clubsService.js'

export async function handleListClubs(req: Request, res: Response): Promise<void> {
  const league = req.query.league as string | undefined
  const clubs = await listClubs(league)
  res.json(clubs)
}

export async function handleGetClub(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10)
  const club = await getClubById(id)
  if (!club) {
    res.status(404).json({ error: 'Club not found' })
    return
  }
  res.json(club)
}
