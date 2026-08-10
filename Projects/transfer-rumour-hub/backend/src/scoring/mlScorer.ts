/**
 * Async scoring wrapper — tries the ML model service, falls back to the
 * heuristic engine on any failure. This is the swap path `likelihoodEngine.ts`
 * describes: callers that want the (potential) ML score go through here;
 * `computeScore()` itself stays sync and heuristic-only so its existing tests
 * don't need to change.
 *
 * The model service is opt-in (unset MODEL_SERVICE_URL = heuristic only) and
 * self-gates: it returns 503 until enough labeled outcomes exist to train on,
 * so this fallback path is also what runs during that cold-start period.
 */
import { computeScore, type ScoringInputs, type ScoringOutput } from './likelihoodEngine.js'

export type ScoredOutput = ScoringOutput & { scoreSource: 'heuristic' | 'ml' }

const TIMEOUT_MS = 1500

export async function computeScoreML(inputs: ScoringInputs): Promise<ScoredOutput> {
  const heuristic = computeScore(inputs)
  const modelUrl = process.env.MODEL_SERVICE_URL
  if (!modelUrl) return { ...heuristic, scoreSource: 'heuristic' }

  try {
    const res = await fetch(`${modelUrl}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ...heuristic, scoreSource: 'heuristic' }

    const data = (await res.json()) as { score: number }
    const score = Math.round(Math.max(0, Math.min(100, data.score)))
    // Model gives a bare probability-derived score; keep the heuristic's
    // component breakdown for explainability since the RF doesn't produce one.
    return { score, breakdown: heuristic.breakdown, scoreSource: 'ml' }
  } catch {
    return { ...heuristic, scoreSource: 'heuristic' }
  }
}
