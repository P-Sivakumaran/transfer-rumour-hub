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
