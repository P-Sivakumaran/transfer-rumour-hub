import { Router, type Request, type Response } from 'express'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

router.get('/sources', async (_req: Request, res: Response) => {
  const sources = await prisma.source.findMany({
    orderBy: { reliabilityScore: 'desc' },
    include: { _count: { select: { rumours: true } } },
  })
  res.json(sources)
})

router.get('/overview', async (_req: Request, res: Response) => {
  const [totalRumours, hotRumours, completedRumours] = await Promise.all([
    prisma.rumour.count(),
    prisma.rumour.count({ where: { status: 'HOT' } }),
    prisma.rumour.count({ where: { status: 'COMPLETED' } }),
  ])
  res.json({ totalRumours, hotRumours, completedRumours })
})

export default router
