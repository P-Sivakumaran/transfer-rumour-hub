/**
 * Client for ml-service's forecasting endpoints. Deliberately has NO
 * fallback-to-heuristic behavior, unlike computeScore() in
 * likelihoodEngine.ts. That fallback pattern is correct for a 0–100
 * "likelihood" heuristic score (it was always a heuristic; falling back to
 * one is a like-for-like degrade). It is wrong here: a failed/unavailable
 * call to this client must surface as INSUFFICIENT_DATA in
 * forecastService.ts, never as a silently-substituted number rendered into
 * a probability display — that's exactly the "evidence strength is not a
 * probability" rule this whole pipeline exists to enforce.
 */
import axios from 'axios'

export interface ScoreRequest {
  features: Record<string, number>
  forecastDefinitionVersion: number
}

export interface ScoreResponse {
  rawScore: number
  calibratedProbability: number
  uncertaintyLow: number
  uncertaintyHigh: number
  modelVersion: string
}

const ML_FORECAST_URL = process.env.ML_FORECAST_URL // e.g. http://localhost:8000/forecast/score
const ML_FORECAST_TIMEOUT_MS = Number(process.env.ML_FORECAST_TIMEOUT_MS ?? 2000)
const ML_SERVICE_KEY = process.env.ML_SERVICE_KEY

export interface MlForecastClient {
  score(req: ScoreRequest): Promise<ScoreResponse>
}

export function createMlForecastClient(): MlForecastClient {
  return {
    async score(req: ScoreRequest): Promise<ScoreResponse> {
      if (!ML_FORECAST_URL) throw new Error('ML_FORECAST_URL not configured')
      const { data } = await axios.post<ScoreResponse>(ML_FORECAST_URL, req, {
        timeout: ML_FORECAST_TIMEOUT_MS,
        headers: ML_SERVICE_KEY ? { 'X-ML-Service-Key': ML_SERVICE_KEY } : undefined,
      })
      return data
    },
  }
}
