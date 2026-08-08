import 'express-async-errors'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'

import rumoursRouter from './routes/rumours.js'
import playersRouter from './routes/players.js'
import clubsRouter from './routes/clubs.js'
import statsRouter from './routes/stats.js'
import graphRouter from './routes/graph.js'
import adminRouter from './routes/admin.js'
import billingRouter from './routes/billing.js'
import { addClient, clientCount } from './sse/broadcaster.js'
import { startWorkers } from './queue/workers.js'
import { scheduleRecurringJobs } from './queue/scheduler.js'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000' }))
app.use(express.json())

// ─── REST routes ──────────────────────────────────────────────────────────
app.use('/rumours', rumoursRouter)
app.use('/players', playersRouter)
app.use('/clubs', clubsRouter)
app.use('/stats', statsRouter)
app.use('/graph', graphRouter)
app.use('/admin', adminRouter)
app.use('/billing', billingRouter)

// ─── SSE endpoint ─────────────────────────────────────────────────────────
app.get('/events', (req: Request, res: Response) => {
  const clientId = randomUUID()
  addClient(clientId, res)
  console.log(`[SSE] Client connected: ${clientId} (total: ${clientCount()})`)
})

// ─── Error handler ─────────────────────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation error', details: err.errors })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`)
  startWorkers()
  scheduleRecurringJobs().catch(console.error)
})

export default app
