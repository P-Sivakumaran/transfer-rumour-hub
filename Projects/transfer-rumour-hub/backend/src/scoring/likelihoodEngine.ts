/**
 * Likelihood Scoring Engine
 *
 * Produces a 0–100 score for each transfer rumour.
 * Designed so the `computeScore` function can later be swapped for an ML model
 * (e.g. a RandomForest trained on historic rumour outcomes) without changing callers.
 *
 * Swap path: replace `heuristicScore` with a call to a Python scoring micro-service
 * that accepts the same `ScoringInputs` and returns `ScoringOutput`.
 */

export interface ScoringInputs {
  /** 0.0–1.0 — how reliable the reporting source is */
  sourceReliability: number

  /** Months until the player's contract expires. Null = unknown */
  monthsToContractExpiry: number | null

  /** Reported fee in millions EUR. Null = undisclosed */
  reportedFeeMin: number | null
  reportedFeeMax: number | null

  /** Player market value in millions EUR. Null = unknown */
  marketValue: number | null

  /** 0.0–1.0 — how much the destination club needs this position */
  clubNeedScore: number

  /** Number of independent sources reporting this same rumour */
  distinctSourceCount: number

  /** Raw probability from data provider, if available (0.0–1.0) */
  baseProbability?: number
}

export interface ScoringOutput {
  /** Final 0–100 likelihood score */
  score: number
  /** Breakdown of each component's contribution for explainability */
  breakdown: {
    source: number
    contract: number
    feeAlignment: number
    clubNeed: number
    sourceCount: number
    providerBonus: number
  }
}

/**
 * Weight budget (must sum to 100):
 *   source reliability  → 28 pts
 *   contract urgency    → 20 pts
 *   fee alignment       → 12 pts
 *   club need           → 20 pts
 *   source count        → 15 pts
 *   provider bonus      →  5 pts
 */
const WEIGHTS = {
  source: 28,
  contract: 20,
  feeAlignment: 12,
  clubNeed: 20,
  sourceCount: 15,
  providerBonus: 5,
} as const

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function heuristicScore(inputs: ScoringInputs): ScoringOutput {
  // --- Source reliability (0–28) ---
  const source = clamp(inputs.sourceReliability, 0, 1) * WEIGHTS.source

  // --- Contract urgency (0–20) ---
  // Contracts expiring ≤6 months → max points. 24+ months → 0 points.
  let contract = 0
  if (inputs.monthsToContractExpiry !== null) {
    const urgency = 1 - clamp(inputs.monthsToContractExpiry / 24, 0, 1)
    contract = urgency * WEIGHTS.contract
  } else {
    // Unknown expiry — assume mid-range urgency
    contract = WEIGHTS.contract * 0.4
  }

  // --- Fee alignment (0–12) ---
  // Ideal: reported fee is within ±20% of market value.
  // Very high or very low fees reduce alignment.
  let feeAlignment = 0
  const fee =
    inputs.reportedFeeMin !== null && inputs.reportedFeeMax !== null
      ? (inputs.reportedFeeMin + inputs.reportedFeeMax) / 2
      : inputs.reportedFeeMin ?? inputs.reportedFeeMax

  if (fee !== null && fee !== undefined && inputs.marketValue) {
    const ratio = fee / inputs.marketValue
    // Penalty for ratio far from 1.0 — peaks at ratio=1, tails off each side
    const alignment = Math.max(0, 1 - Math.abs(ratio - 1) * 1.5)
    feeAlignment = alignment * WEIGHTS.feeAlignment
  } else {
    // Undisclosed fee — small default
    feeAlignment = WEIGHTS.feeAlignment * 0.3
  }

  // --- Club need (0–20) ---
  const clubNeed = clamp(inputs.clubNeedScore, 0, 1) * WEIGHTS.clubNeed

  // --- Distinct source count (0–15) ---
  // Diminishing returns: 1 source → ~5pts, 3 sources → ~11pts, 5+ → 15pts
  const sourceCount =
    Math.min(1, 1 - Math.exp(-inputs.distinctSourceCount * 0.5)) * WEIGHTS.sourceCount

  // --- Provider base probability bonus (0–5) ---
  const providerBonus = inputs.baseProbability
    ? inputs.baseProbability * WEIGHTS.providerBonus
    : WEIGHTS.providerBonus * 0.5

  const raw = source + contract + feeAlignment + clubNeed + sourceCount + providerBonus
  const score = Math.round(clamp(raw, 0, 100))

  return {
    score,
    breakdown: {
      source: Math.round(source),
      contract: Math.round(contract),
      feeAlignment: Math.round(feeAlignment),
      clubNeed: Math.round(clubNeed),
      sourceCount: Math.round(sourceCount),
      providerBonus: Math.round(providerBonus),
    },
  }
}

/**
 * Public API — call this everywhere.
 * To swap in an ML model: replace the body with a fetch to your Python scoring service.
 */
export function computeScore(inputs: ScoringInputs): ScoringOutput {
  return heuristicScore(inputs)
}
