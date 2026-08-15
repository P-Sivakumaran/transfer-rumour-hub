import type { Response } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import type { AuthedRequest } from '../middleware/auth.js'
import { logProductEvent } from '../analytics/events.js'

const prisma = new PrismaClient()

// Only the two events with no corresponding server-side gated action are
// accepted here — WATCHLIST_CREATED, ALERT_ACTIVATED, and
// FORECAST_HISTORY_VIEWED are logged directly by the routes that already
// enforce/observe them (watchlistController.ts, claimsController.ts), not
// via a client-callable endpoint, since a server-observed event is more
// reliable than trusting the client to always fire it.
//
// Metadata is a closed allowlist per event type — no claimId/playerId
// accepted for PROVENANCE_PANEL_VIEWED, deliberately, per
// docs/monetisation-proposal.md "Privacy and data-licensing
// considerations": aggregate usage answers the product question, per-claim
// viewing history is a more sensitive shape of data than is needed.
const EventSchema = z.discriminatedUnion('eventType', [
  z.object({ eventType: z.literal('PROVENANCE_PANEL_VIEWED') }),
  z.object({
    eventType: z.literal('UPGRADE_INTEREST_CLICKED'),
    metadata: z.object({ featureKey: z.string() }).optional(),
  }),
])

export async function handleLogEvent(req: AuthedRequest, res: Response): Promise<void> {
  const parsed = EventSchema.parse(req.body)
  await logProductEvent(prisma, req.userId ?? null, parsed.eventType, 'metadata' in parsed ? parsed.metadata : undefined)
  res.status(204).end()
}
