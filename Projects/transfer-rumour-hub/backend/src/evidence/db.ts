/**
 * Minimal slice of PrismaClient the evidence module actually uses — lets
 * tests inject an in-memory fake instead of a real database, same style as
 * `SyncDb` in playerClubSync.ts and `db: PrismaClient` params in
 * outcomeDetector.ts.
 */

export interface ClaimRow {
  id: number
  playerId: number
  fromClubId: number | null
  toClubId: number | null
  transferType: string
  claimStatus: string
  firstSeenAt: Date
  lastEvidenceAt: Date
  [key: string]: unknown
}

export interface EvidenceItemRow {
  id: number
  claimId: number
  sourceId: number
  canonicalUrl: string
  publishedAt: Date
  fetchedAt: Date
  authorName: string | null
  sourceType: string
  title: string
  rawExcerpt: string
  extractedAttributions: unknown
  evidenceDirection: string
  parentEvidenceItemId: number | null
  provenanceRootId: number | null
  extractionConfidence: number
  [key: string]: unknown
}

export interface SourceRow {
  id: number
  name: string
  [key: string]: unknown
}

export interface EvidenceDb {
  claim: {
    findFirst(args: any): Promise<ClaimRow | null>
    findMany(args: any): Promise<ClaimRow[]>
    create(args: any): Promise<ClaimRow>
    update(args: any): Promise<ClaimRow>
    count(args: any): Promise<number>
  }
  evidenceItem: {
    findFirst(args: any): Promise<EvidenceItemRow | null>
    findMany(args: any): Promise<EvidenceItemRow[]>
    create(args: any): Promise<EvidenceItemRow>
    update(args: any): Promise<EvidenceItemRow>
  }
  evidenceDuplicateCandidate: {
    create(args: any): Promise<unknown>
    findMany(args: any): Promise<{ id: number; evidenceItemId: number; candidateItemId: number; similarityScore: number; reviewedAt: Date | null }[]>
    update(args: any): Promise<unknown>
  }
  source: {
    findMany(args: any): Promise<SourceRow[]>
  }
}
