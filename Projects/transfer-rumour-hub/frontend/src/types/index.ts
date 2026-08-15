export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST' | 'CF'
export type TransferWindow = 'SUMMER' | 'WINTER' | 'FREE_AGENT'
export type RumourStatus = 'PENDING' | 'HOT' | 'COMPLETED' | 'FAILED' | 'DENIED'
export type SourceType = 'JOURNALIST' | 'CLUB_OFFICIAL' | 'AGENT' | 'NEWS_OUTLET' | 'SOCIAL_MEDIA' | 'AGGREGATOR'

export interface Club {
  id: number
  name: string
  shortName: string | null
  league: string
  country: string
  logoUrl: string | null
}

export interface Player {
  id: number
  name: string
  age: number | null
  position: Position
  currentClub: Club | null
  contractEnd: string | null
  marketValue: number | null
  nationality: string | null
  photoUrl: string | null
}

export interface Source {
  id: number
  name: string
  type: SourceType
  reliabilityScore: number
  url: string | null
}

export interface Rumour {
  id: number
  player: Player
  fromClub: Club
  fromClubInferred: boolean
  toClub: Club
  source: Source
  reportedFeeMin: number | null
  reportedFeeMax: number | null
  currency: string
  rumourDate: string
  window: TransferWindow
  baseProbability: number
  computedLikelihood: number
  status: RumourStatus
  distinctSourceCount: number
  notes: string | null
}

export interface RumourHistoryPoint {
  computedLikelihood: number
  recordedAt: string
}

export interface EvidenceItem {
  sourceName: string
  headline: string
  link: string
  publishedAt: string
}

export interface RumourDetail extends Rumour {
  history: RumourHistoryPoint[]
  evidence: EvidenceItem[]
}

export interface ClubDetail extends Club {
  players: Player[]
  activeIn: Rumour[]
  activeOut: Rumour[]
  totalExpectedSpend: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface AdminRumour {
  id: number
  computedLikelihood: number
  status: RumourStatus
  contradicts: number | null
  rumourDate: string
  notes: string | null
  player: { name: string }
  fromClub: { name: string }
  toClub: { name: string }
  source: { name: string; reliabilityScore: number }
  evidence: EvidenceItem[]
}

export interface AdminSource {
  id: number
  name: string
  type: SourceType
  reliabilityScore: number
  hitCount: number
  missCount: number
  country: string | null
  url: string | null
  _count: { rumours: number }
}

// ─── Provenance-first evidence model + calibrated forecasting (2026-08-14) ──
// Parallel to Rumour above — see docs/forecasting-audit.md and
// docs/forecasting-methodology.md for why these are a second model rather
// than a Rumour extension.

export type ClaimStatus = 'ACTIVE' | 'DENIED' | 'SUPERSEDED' | 'CONFIRMED' | 'EXPIRED'
export type TransferType = 'PERMANENT' | 'LOAN' | 'FREE' | 'UNKNOWN'
export type EvidenceDirection = 'SUPPORTS' | 'CONTRADICTS' | 'CONFIRMS' | 'DENIES' | 'CONTEXTUAL'
export type ForecastDisplayMode = 'PRECISE' | 'INTERVAL' | 'INSUFFICIENT_DATA'

export interface EvidenceItemData {
  id: number
  claimId: number
  sourceId: number
  canonicalUrl: string
  publishedAt: string
  fetchedAt: string
  authorName: string | null
  sourceType: SourceType
  title: string
  rawExcerpt: string
  evidenceDirection: EvidenceDirection
  parentEvidenceItemId: number | null
  provenanceRootId: number | null
  extractionConfidence: number
  // Present when the API response embeds the source's name/tier alongside
  // the evidence item (not persisted on EvidenceItem itself — joined at
  // read time). Optional because not every endpoint includes it.
  sourceName?: string
  sourceTier?: number | null
}

export interface ProvenanceCluster {
  root: EvidenceItemData
  syndicated: EvidenceItemData[]
}

export interface Claim {
  id: number
  playerId: number
  fromClubId: number | null
  toClubId: number | null
  transferType: TransferType
  statedFee: number | null
  statedContractLengthMonths: number | null
  claimStatus: ClaimStatus
  window: TransferWindow | null
  firstSeenAt: string
  lastEvidenceAt: string
  // Denormalized display fields — not on the raw DB row, populated by the
  // claim detail endpoint/fixtures for convenience.
  player?: Player
  fromClub?: Club | null
  toClub?: Club | null
}

export interface ClaimDetail extends Claim {
  evidenceCount: number
  independentSourceCount: number
  provenanceClusters: ProvenanceCluster[]
  officialConfirmation: EvidenceItemData | null
  officialDenial: EvidenceItemData | null
}

export interface ForecastDisplayData {
  displayMode: ForecastDisplayMode
  calibratedProbability?: number
  uncertaintyLow?: number
  uncertaintyHigh?: number
  rawScore?: number
  modelVersion?: string
  insufficientDataReason?: string
  featureSnapshotHash: string
  predictionTimestamp?: string
}

export interface ForecastHistoryPoint {
  predictionTimestamp: string
  calibratedProbability: number | null
  uncertaintyLow: number | null
  uncertaintyHigh: number | null
  displayMode: ForecastDisplayMode
  rawScore: number | null
}

export interface ForecastFactor {
  label: string
  direction: 'positive' | 'negative'
  magnitude: number // 0–1, relative weight for sizing/sorting
  explanation: string
  evidenceItemId?: number
}

export interface ModelHealthDefinition {
  id: number
  version: number
  horizonDays: number
  currentModel: {
    version: string
    trainedAt: string
    trainingDataSource: string
    nTrainSamples: number
    nTestSamples: number
    minSampleSizeForPrecise: number
    meetsMinSampleSize: boolean
    brierScore: number | null
    logLoss: number | null
    calibrationCurve: { binLow: number; binHigh: number; meanPredicted: number; empiricalRate: number; n: number }[] | null
  } | null
}

export interface ModelHealthResponse {
  definitions: ModelHealthDefinition[]
  mlService: { reachable: boolean; detail?: unknown }
}

// Monetisation entitlement model (2026-08-14) — see
// docs/monetisation-proposal.md.
export type EntitlementTier = 'FREE' | 'PRO' | 'RESEARCH'
export type EntitlementDenialReason = 'INSUFFICIENT_TIER' | 'FEATURE_DISABLED'

export interface EntitlementDenial {
  reason?: EntitlementDenialReason
  requiredTier: EntitlementTier
  currentTier?: EntitlementTier
  limit?: number
}

export interface WatchlistItem {
  id: number
  userId: number
  playerId: number
  alertMode: 'DELAYED' | 'INSTANT'
  createdAt: string
  player: Player & { currentClub: Club | null }
}
