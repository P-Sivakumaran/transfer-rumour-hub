import type { ClaimRow, EvidenceDb } from './db.js'

export interface FindOrCreateClaimInput {
  playerId: number
  fromClubId?: number | null
  toClubId?: number | null
  transferType?: string // TransferType enum value, default UNKNOWN
  statedFee?: number | null
  statedContractLengthMonths?: number | null
  seenAt: Date
}

/**
 * A Claim is the durable canonical assertion for a (player, fromClub,
 * toClub) tuple — unlike Rumour's rolling 7-day dedup window
 * (workers.ts:157-164), a Claim persists indefinitely once created and
 * accumulates evidence over the life of the transfer saga. Matches on the
 * tuple among non-terminal claims (ACTIVE) only — a DENIED/EXPIRED claim
 * for the same tuple doesn't absorb new evidence; a fresh claim starts
 * instead, since "this deal is off" and "this deal is back on" are
 * different assertions worth tracking separately.
 */
export async function findOrCreateClaim(db: EvidenceDb, input: FindOrCreateClaimInput): Promise<ClaimRow> {
  const existing = await db.claim.findFirst({
    where: {
      playerId: input.playerId,
      fromClubId: input.fromClubId ?? null,
      toClubId: input.toClubId ?? null,
      claimStatus: 'ACTIVE',
    },
  })
  if (existing) return existing

  return db.claim.create({
    data: {
      playerId: input.playerId,
      fromClubId: input.fromClubId ?? null,
      toClubId: input.toClubId ?? null,
      transferType: input.transferType ?? 'UNKNOWN',
      statedFee: input.statedFee ?? null,
      statedContractLengthMonths: input.statedContractLengthMonths ?? null,
      claimStatus: 'ACTIVE',
      firstSeenAt: input.seenAt,
      lastEvidenceAt: input.seenAt,
    },
  })
}

export async function getClaimById(db: EvidenceDb, id: number): Promise<ClaimRow | null> {
  return db.claim.findFirst({ where: { id } })
}

export interface ListClaimsFilters {
  playerId?: number
  claimStatus?: string
  page?: number
  limit?: number
  // Advanced filter (Pro entitlement, ADVANCED_FILTERS — see
  // entitlements/flags.ts): only claims with at least one evidence item
  // from a source at this tier or better (1 = best, matches Source.tier's
  // existing "Tier N" convention). Undefined = no filtering, same as today.
  sourceTierAtBest?: number
}

export async function listClaims(
  db: EvidenceDb,
  filters: ListClaimsFilters,
): Promise<{ data: ClaimRow[]; total: number; page: number; limit: number }> {
  const page = filters.page ?? 1
  const limit = Math.min(filters.limit ?? 20, 100)
  const where: Record<string, unknown> = {}
  if (filters.playerId) where.playerId = filters.playerId
  if (filters.claimStatus) where.claimStatus = filters.claimStatus
  if (filters.sourceTierAtBest !== undefined) {
    where.evidence = { some: { source: { tier: { lte: filters.sourceTierAtBest } } } }
  }

  const [data, total] = await Promise.all([
    db.claim.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { lastEvidenceAt: 'desc' } }),
    db.claim.count({ where }),
  ])
  return { data, total, page, limit }
}
