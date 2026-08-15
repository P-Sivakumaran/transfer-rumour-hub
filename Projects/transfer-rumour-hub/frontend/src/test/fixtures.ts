/**
 * Shared fixtures for component tests. Mirrors the real scenarios seeded
 * server-side in backend/prisma/seedEvidence.ts (the Gyökeres 1-original
 * + 4-syndication + official-confirmation claim) and adds an official
 * DENIAL scenario, which the backend seed doesn't cover.
 */
import type {
  Claim,
  ClaimDetail,
  EvidenceItemData,
  ForecastDisplayData,
  ForecastHistoryPoint,
  ModelHealthResponse,
  Player,
  Club,
} from '@/types'

export const arsenal: Club = { id: 10, name: 'Arsenal', shortName: 'Arsenal', league: 'Premier League', country: 'England', logoUrl: null }
export const manCity: Club = { id: 11, name: 'Manchester City', shortName: 'Man City', league: 'Premier League', country: 'England', logoUrl: null }
export const juventus: Club = { id: 12, name: 'Juventus', shortName: 'Juve', league: 'Serie A', country: 'Italy', logoUrl: null }

export const gyokeres: Player = {
  id: 20, name: 'Viktor Gyökeres', age: 26, position: 'ST', currentClub: arsenal,
  contractEnd: '2028-06-30', marketValue: 120, nationality: 'Sweden', photoUrl: null,
}
export const david: Player = {
  id: 21, name: 'Jonathan David', age: 24, position: 'ST', currentClub: juventus,
  contractEnd: '2026-06-30', marketValue: 40, nationality: 'Canada', photoUrl: null,
}

function evidence(overrides: Partial<EvidenceItemData> & Pick<EvidenceItemData, 'id' | 'canonicalUrl' | 'title' | 'sourceType' | 'evidenceDirection' | 'publishedAt'>): EvidenceItemData {
  return {
    claimId: 1,
    sourceId: 1,
    fetchedAt: overrides.publishedAt,
    authorName: null,
    rawExcerpt: overrides.title,
    parentEvidenceItemId: null,
    provenanceRootId: overrides.id,
    extractionConfidence: 0.85,
    sourceName: 'Unknown Source',
    sourceTier: 3,
    ...overrides,
  }
}

// ── Scenario 1: one original scoop + four syndications + official confirmation ──
export const original = evidence({
  id: 1, sourceId: 1, sourceName: 'Fabrizio Romano', sourceTier: 1,
  canonicalUrl: 'https://twitter.com/FabrizioRomano/status/1',
  publishedAt: '2026-08-10T09:00:00Z',
  title: 'Here we go! Viktor Gyökeres to Manchester City, £85m deal agreed',
  sourceType: 'JOURNALIST', evidenceDirection: 'SUPPORTS', extractionConfidence: 0.95,
  provenanceRootId: 1,
})

export const syndication1 = evidence({
  id: 2, sourceId: 2, sourceName: 'Sky Sports', sourceTier: 2,
  canonicalUrl: 'https://skysports.com/gyokeres-1',
  publishedAt: '2026-08-10T09:15:00Z',
  title: 'Gyökeres to Man City: deal agreed, according to Fabrizio Romano',
  sourceType: 'NEWS_OUTLET', evidenceDirection: 'SUPPORTS', extractionConfidence: 0.8,
  parentEvidenceItemId: 1, provenanceRootId: 1,
})
export const syndication2 = evidence({
  id: 3, sourceId: 3, sourceName: 'The Athletic', sourceTier: 2,
  canonicalUrl: 'https://theathletic.com/gyokeres-1',
  publishedAt: '2026-08-10T09:30:00Z',
  title: 'Manchester City agree £85m deal for Gyökeres, as reported by Fabrizio Romano',
  sourceType: 'NEWS_OUTLET', evidenceDirection: 'SUPPORTS', extractionConfidence: 0.8,
  parentEvidenceItemId: 1, provenanceRootId: 1,
})
export const syndication3 = evidence({
  id: 4, sourceId: 4, sourceName: 'Marca', sourceTier: 3,
  canonicalUrl: 'https://marca.com/gyokeres-1',
  publishedAt: '2026-08-10T10:00:00Z',
  title: 'Gyökeres al Manchester City por 85 millones, per Fabrizio Romano',
  sourceType: 'NEWS_OUTLET', evidenceDirection: 'SUPPORTS', extractionConfidence: 0.75,
  parentEvidenceItemId: 1, provenanceRootId: 1,
})
export const syndication4 = evidence({
  id: 5, sourceId: 5, sourceName: 'Unknown Twitter Account', sourceTier: 5,
  canonicalUrl: 'https://x.com/gyokeres-1',
  publishedAt: '2026-08-10T10:05:00Z',
  title: 'GYOKERES TO CITY CONFIRMED citing Fabrizio Romano 🚨',
  sourceType: 'SOCIAL_MEDIA', evidenceDirection: 'SUPPORTS', extractionConfidence: 0.6,
  parentEvidenceItemId: 1, provenanceRootId: 1,
})
export const officialConfirmationItem = evidence({
  id: 6, sourceId: 6, sourceName: 'Manchester City Official', sourceTier: 1,
  canonicalUrl: 'https://mancity.com/gyokeres-signing',
  publishedAt: '2026-08-11T12:00:00Z',
  title: 'Manchester City completes the transfer of Viktor Gyökeres',
  sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'CONFIRMS', extractionConfidence: 1.0,
  provenanceRootId: 6,
})

export const gyokeresClaim: Claim = {
  id: 1, playerId: 20, fromClubId: 10, toClubId: 11, transferType: 'PERMANENT',
  statedFee: 85, statedContractLengthMonths: 60, claimStatus: 'ACTIVE', window: 'SUMMER',
  firstSeenAt: '2026-08-10T09:00:00Z', lastEvidenceAt: '2026-08-11T12:00:00Z',
  player: gyokeres, fromClub: arsenal, toClub: manCity,
}

export const gyokeresClaimDetail: ClaimDetail = {
  ...gyokeresClaim,
  evidenceCount: 6,
  independentSourceCount: 2,
  provenanceClusters: [
    { root: original, syndicated: [syndication1, syndication2, syndication3, syndication4] },
    { root: officialConfirmationItem, syndicated: [] },
  ],
  officialConfirmation: officialConfirmationItem,
  officialDenial: null,
}

export const gyokeresForecastPrecise: ForecastDisplayData = {
  displayMode: 'PRECISE',
  calibratedProbability: 0.87,
  uncertaintyLow: 0.79,
  uncertaintyHigh: 0.94,
  rawScore: 0.85,
  modelVersion: 'forecast-v1-db-20260901T000000',
  featureSnapshotHash: 'abc123def456',
  predictionTimestamp: '2026-08-11T12:05:00Z',
}

export const gyokeresForecastHistory: ForecastHistoryPoint[] = [
  { predictionTimestamp: '2026-08-10T09:05:00Z', calibratedProbability: 0.42, uncertaintyLow: 0.3, uncertaintyHigh: 0.55, displayMode: 'PRECISE', rawScore: 0.4 },
  { predictionTimestamp: '2026-08-10T10:10:00Z', calibratedProbability: 0.58, uncertaintyLow: 0.46, uncertaintyHigh: 0.69, displayMode: 'PRECISE', rawScore: 0.55 },
  { predictionTimestamp: '2026-08-11T12:05:00Z', calibratedProbability: 0.87, uncertaintyLow: 0.79, uncertaintyHigh: 0.94, displayMode: 'PRECISE', rawScore: 0.85 },
]

// ── Scenario 2: official denial ──────────────────────────────────────────
export const davidOriginal = evidence({
  id: 10, sourceId: 2, sourceName: 'Sky Sports', sourceTier: 2,
  canonicalUrl: 'https://skysports.com/david-1',
  publishedAt: '2026-08-05T08:00:00Z',
  title: 'Jonathan David linked with Juventus exit amid PSG interest',
  sourceType: 'NEWS_OUTLET', evidenceDirection: 'SUPPORTS', extractionConfidence: 0.7,
  provenanceRootId: 10,
})
export const davidDenialItem = evidence({
  id: 11, sourceId: 7, sourceName: 'Juventus Official', sourceTier: 1,
  canonicalUrl: 'https://juventus.com/statement-david',
  publishedAt: '2026-08-06T14:00:00Z',
  title: 'Juventus statement: Jonathan David is not for sale',
  sourceType: 'CLUB_OFFICIAL', evidenceDirection: 'DENIES', extractionConfidence: 1.0,
  provenanceRootId: 11,
})

export const davidClaim: Claim = {
  id: 2, playerId: 21, fromClubId: 12, toClubId: null, transferType: 'PERMANENT',
  statedFee: null, statedContractLengthMonths: null, claimStatus: 'DENIED', window: 'SUMMER',
  firstSeenAt: '2026-08-05T08:00:00Z', lastEvidenceAt: '2026-08-06T14:00:00Z',
  player: david, fromClub: juventus, toClub: null,
}

export const davidClaimDetail: ClaimDetail = {
  ...davidClaim,
  evidenceCount: 2,
  independentSourceCount: 2,
  provenanceClusters: [
    { root: davidOriginal, syndicated: [] },
    { root: davidDenialItem, syndicated: [] },
  ],
  officialConfirmation: null,
  officialDenial: davidDenialItem,
}

export const davidForecastInsufficient: ForecastDisplayData = {
  displayMode: 'INSUFFICIENT_DATA',
  insufficientDataReason: 'The current model is trained on synthetic data only — no calibrated probability can be shown until enough resolved real outcomes exist to train on.',
  featureSnapshotHash: 'def456ghi789',
}

// ── Scenario 3: wide uncertainty → INTERVAL display ──────────────────────
export const intervalForecast: ForecastDisplayData = {
  displayMode: 'INTERVAL',
  calibratedProbability: 0.5,
  uncertaintyLow: 0.22,
  uncertaintyHigh: 0.78,
  rawScore: 0.5,
  modelVersion: 'forecast-v1-db-20260901T000000',
  featureSnapshotHash: 'ghi789jkl012',
  predictionTimestamp: '2026-08-06T14:05:00Z',
}

// ── Empty forecast history (new claim, never scored before) ──────────────
export const emptyForecastHistory: ForecastHistoryPoint[] = []

export const modelHealthTrained: ModelHealthResponse = {
  definitions: [
    {
      id: 1, version: 1, horizonDays: 30,
      currentModel: {
        version: 'forecast-v1-db-20260901T000000', trainedAt: '2026-09-01T00:00:00Z',
        trainingDataSource: 'db', nTrainSamples: 900, nTestSamples: 300,
        minSampleSizeForPrecise: 200, meetsMinSampleSize: true,
        brierScore: 0.14, logLoss: 0.42,
        calibrationCurve: [
          { binLow: 0, binHigh: 0.5, meanPredicted: 0.3, empiricalRate: 0.28, n: 150 },
          { binLow: 0.5, binHigh: 1, meanPredicted: 0.8, empiricalRate: 0.82, n: 150 },
        ],
      },
    },
  ],
  mlService: { reachable: true },
}

export const modelHealthInsufficient: ModelHealthResponse = {
  definitions: [
    {
      id: 1, version: 1, horizonDays: 30,
      currentModel: {
        version: 'forecast-v1-synthetic-20260813T215951', trainedAt: '2026-08-13T21:59:51Z',
        trainingDataSource: 'synthetic', nTrainSamples: 2400, nTestSamples: 800,
        minSampleSizeForPrecise: 200, meetsMinSampleSize: true,
        brierScore: 0.1736, logLoss: 0.5395,
        calibrationCurve: [],
      },
    },
  ],
  mlService: { reachable: true },
}
