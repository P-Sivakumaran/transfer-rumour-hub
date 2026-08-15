import type { Response } from 'express'
import { PrismaClient } from '@prisma/client'
import type { AuthedRequest } from '../middleware/auth.js'

const prisma = new PrismaClient()

// Research/API tier stubs (docs/monetisation-proposal.md). These prove the
// entitlement gate — RESEARCH tier + a default-off feature flag (see
// entitlements/flags.ts) — with real, application-owned data, not
// synthetic placeholders. Not a shipped public API: no API-key auth (reuses
// the same cookie session as every other tier), no rate limiting, no
// license terms enforcement. See docs/monetisation-proposal.md
// "Limitations".
//
// Returns this product's own analysis (resolved Claim outcomes, evidence
// provenance metadata) — never raw Sportmonks-sourced fields — deliberately,
// per the data-licensing reasoning in the proposal doc.

export async function handleHistoricalClaims(_req: AuthedRequest, res: Response): Promise<void> {
  const claims = await prisma.claim.findMany({
    where: { claimStatus: { in: ['CONFIRMED', 'DENIED', 'EXPIRED'] } },
    select: {
      id: true,
      claimStatus: true,
      playerId: true,
      fromClubId: true,
      toClubId: true,
      transferType: true,
      window: true,
      firstSeenAt: true,
      lastEvidenceAt: true,
    },
    orderBy: { lastEvidenceAt: 'desc' },
    take: 500,
  })
  res.json({ data: claims, license: 'See docs/monetisation-proposal.md — Research/API license terms not yet finalized.' })
}

export async function handleEvidenceMetadata(_req: AuthedRequest, res: Response): Promise<void> {
  const evidence = await prisma.evidenceItem.findMany({
    select: {
      id: true,
      claimId: true,
      sourceId: true,
      provenanceRootId: true,
      evidenceDirection: true,
      sourceType: true,
      publishedAt: true,
    },
    orderBy: { publishedAt: 'desc' },
    take: 500,
  })
  res.json({ data: evidence, license: 'See docs/monetisation-proposal.md — Research/API license terms not yet finalized.' })
}
