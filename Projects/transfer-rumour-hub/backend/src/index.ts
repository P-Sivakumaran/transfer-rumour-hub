import 'dotenv/config'
import 'express-async-errors'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'
import { PrismaClient } from '@prisma/client'

import rumoursRouter from './routes/rumours.js'
import playersRouter from './routes/players.js'
import clubsRouter from './routes/clubs.js'
import statsRouter from './routes/stats.js'
import graphRouter from './routes/graph.js'
import claimsRouter from './routes/claims.js'
import forecastRouter from './routes/forecast.js'
import adminRouter from './routes/admin.js'
import billingRouter from './routes/billing.js'
import authRouter from './routes/auth.js'
import watchlistRouter from './routes/watchlist.js'
import researchRouter from './routes/research.js'
import analyticsRouter from './routes/analytics.js'
import apiKeysRouter from './routes/apiKeys.js'
import { addClient, clientCount } from './sse/broadcaster.js'
import { startWorkers } from './queue/workers.js'
import { scheduleRecurringJobs } from './queue/scheduler.js'
import { correlationId } from './lib/correlationId.js'
import { bootstrapAdminFromEnv } from './admin/bootstrap.js'
import type { BootstrapDb } from './admin/db.js'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)
const prisma = new PrismaClient()

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000', credentials: true }))
app.use(express.json())
app.use(cookieParser())
app.use(correlationId)

// ─── REST routes ──────────────────────────────────────────────────────────
app.use('/rumours', rumoursRouter)
app.use('/players', playersRouter)
app.use('/clubs', clubsRouter)
app.use('/stats', statsRouter)
app.use('/graph', graphRouter)
// Additive — parallel provenance/evidence model, does not change /rumours'
// existing contract. See docs/forecasting-audit.md.
app.use('/claims', claimsRouter)
app.use('/forecast', forecastRouter)
app.use('/admin', adminRouter)
app.use('/billing', billingRouter)
app.use('/auth', authRouter)
app.use('/watchlist', watchlistRouter)
// Research/API tier stubs — see docs/monetisation-proposal.md.
app.use('/research', researchRouter)
app.use('/analytics', analyticsRouter)
// API-key management (Research tier) — see docs/research-api.md.
app.use('/api-keys', apiKeysRouter)

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
  bootstrapAdminFromEnv(prisma as unknown as BootstrapDb).catch(console.error)
})

export default app
