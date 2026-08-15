/**
 * Minimal slice of PrismaClient the forecasting module uses — same
 * dependency-injection style as SyncDb (playerClubSync.ts) and EvidenceDb
 * (evidence/db.ts).
 *
 * Deliberately does NOT include Source.reliabilityScore/hitCount/missCount
 * in anything selected here — see featureSnapshot.ts's header comment for
 * why those fields are excluded from the feature vector entirely.
 */

export interface ClaimRow {
  id: number
  playerId: number
  fromClubId: number | null
  toClubId: number | null
  transferType: string
  statedFee: number | null
  statedContractLengthMonths: number | null
  claimStatus: string
  window: string | null
  firstSeenAt: Date
  lastEvidenceAt: Date
  [key: string]: unknown
}

export interface EvidenceItemRow {
  id: number
  claimId: number
  sourceId: number
  publishedAt: Date
  sourceType: string
  evidenceDirection: string
  provenanceRootId: number | null
  extractionConfidence: number
  [key: string]: unknown
}

export interface SourceRow {
  id: number
  tier: number | null
  [key: string]: unknown
}

export interface PlayerRow {
  id: number
  contractEnd: Date | null
  [key: string]: unknown
}

export interface ForecastDefinitionRow {
  id: number
  version: number
  horizonDays: number
  summerCutoffMonthDay: string
  winterCutoffMonthDay: string
  isActive: boolean
  [key: string]: unknown
}

export interface ModelVersionRow {
  id: number
  forecastDefinitionId: number
  version: string
  trainingDataSource: string
  nTestSamples: number
  minSampleSizeForPrecise: number
  isCurrent: boolean
  [key: string]: unknown
}

export interface ForecastDb {
  claim: {
    findFirst(args: any): Promise<ClaimRow | null>
  }
  evidenceItem: {
    findMany(args: any): Promise<EvidenceItemRow[]>
  }
  source: {
    findMany(args: any): Promise<SourceRow[]>
  }
  player: {
    findFirst(args: any): Promise<PlayerRow | null>
  }
  forecastDefinition: {
    findFirst(args: any): Promise<ForecastDefinitionRow | null>
  }
  modelVersion: {
    findFirst(args: any): Promise<ModelVersionRow | null>
  }
  claimForecast: {
    create(args: any): Promise<unknown>
  }
}
