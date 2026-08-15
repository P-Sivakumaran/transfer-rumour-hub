import type { Response } from 'express'
import { z } from 'zod'
import { PrismaClient, Prisma } from '@prisma/client'
import { listWatchlist, addToWatchlist, removeFromWatchlist, setAlertMode } from '../services/watchlistService.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { checkEntitlement } from '../entitlements/resolver.js'
import { logProductEvent } from '../analytics/events.js'
import { logOperationalEvent } from '../analytics/operationalEvents.js'
import type { OperationalEventDb } from '../analytics/operationalEvents.js'
import type { CorrelatedRequest } from '../lib/correlationId.js'
import type { EntitlementTier } from '../entitlements/flags.js'

const prisma = new PrismaClient()
const opDb = prisma as unknown as OperationalEventDb

const AddSchema = z.object({ playerId: z.coerce.number().int() })
const AlertModeSchema = z.object({ mode: z.enum(['DELAYED', 'INSTANT']) })

async function tierOf(userId: number): Promise<EntitlementTier> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } })
  return user?.tier ?? 'FREE'
}

export async function handleListWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  const items = await listWatchlist(req.userId!)
  res.json(items)
}

// The free-tier cap check now lives inside services/watchlistService.ts's
// addToWatchlist, wrapped in a transaction + advisory lock — see that
// file's comment for why (closes the TOCTOU gap this controller used to
// have when it counted, then wrote, as two separate un-atomic steps).
export async function handleAddWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  const { playerId } = AddSchema.parse(req.body)
  const correlationId = (req as CorrelatedRequest).correlationId ?? null

  const result = await addToWatchlist(req.userId!, playerId)

  if (!result.ok) {
    await logOperationalEvent(opDb, { eventType: 'WATCHLIST_CAP_REACHED', limit: result.limit }, correlationId)
    res.status(403).json({
      error: 'Free watchlist limit reached',
      reason: 'WATCHLIST_LIMIT_REACHED',
      limit: result.limit,
      requiredTier: 'PRO',
    })
    return
  }

  // Only a genuine first-time add, not a no-op re-add of an
  // already-watchlisted player (see wasCreated's comment in
  // watchlistService.ts) — this used to fire on every duplicate POST.
  if (result.wasCreated) {
    await logProductEvent(prisma, req.userId!, 'WATCHLIST_CREATED', { tier: result.tier })
  }
  res.status(201).json(result.item)
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

// PATCH /watchlist/:playerId/alert-mode — instant-alert entitlement stub.
// Downgrading to DELAYED is always allowed; requesting INSTANT requires the
// entitlement. No delivery mechanism exists — see
// docs/monetisation-proposal.md "Limitations". Setting this preference does
// not cause anything to be sent to the user.
export async function handleSetAlertMode(req: AuthedRequest, res: Response): Promise<void> {
  const playerId = parseInt(req.params.playerId, 10)
  if (isNaN(playerId)) {
    res.status(400).json({ error: 'Invalid playerId' })
    return
  }
  const { mode } = AlertModeSchema.parse(req.body)

  if (mode === 'INSTANT') {
    const tier = await tierOf(req.userId!)
    const check = checkEntitlement(tier, 'INSTANT_ALERTS')
    if (!check.allowed) {
      res.status(403).json({ error: 'Entitlement required', reason: check.reason, requiredTier: check.requiredTier })
      return
    }
  }

  // Write first, log after — setAlertMode's bare update throws (Prisma
  // P2025) when playerId isn't on this user's watchlist. Logging
  // ALERT_ACTIVATED before this call meant a failed write (mapped to a bare
  // 500 previously) still left behind a product event saying the user
  // activated instant alerts for an action that never took effect.
  let item
  try {
    item = await setAlertMode(req.userId!, playerId, mode)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'Player not on watchlist' })
      return
    }
    throw err
  }

  if (mode === 'INSTANT') {
    const tier = await tierOf(req.userId!)
    await logProductEvent(prisma, req.userId!, 'ALERT_ACTIVATED', { tier })
  }

  res.json(item)
}

// GET /watchlist/export.csv — gated by CSV_EXPORT_WATCHLIST (Pro tier AND
// a feature flag that defaults off — see docs/monetisation-proposal.md
// "Data licensing"). Route-level requireEntitlement middleware handles the
// gate; if this handler runs, the caller has already passed it.
// Player/club names come from RSS/Sportmonks ingestion, not a trusted
// source (this codebase has a documented history of garbage entity names
// surviving ingestion) — a name starting with =, +, -, or @ is interpreted
// as a formula by Excel/Sheets on open. Standard CSV-injection mitigation:
// prefix with a single quote so spreadsheet apps render it as literal
// text. Escaping embedded double-quotes alone (the prior behavior) doesn't
// address this — quoting a value doesn't stop a leading '=' from being
// read as a formula.
function csvField(value: string): string {
  const escaped = value.replace(/"/g, '""')
  const safe = /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped
  return `"${safe}"`
}

export async function handleExportWatchlistCsv(req: AuthedRequest, res: Response): Promise<void> {
  const items = await listWatchlist(req.userId!)
  const rows = ['player,current_club,added_at']
  for (const item of items) {
    const name = csvField(item.player.name)
    const club = csvField(item.player.currentClub?.name ?? '')
    rows.push(`${name},${club},${item.createdAt.toISOString()}`)
  }
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="watchlist.csv"')
  res.send(rows.join('\n'))
}
