/**
 * Enforcement point for requirement 5's acceptance gates. Every path that
 * could produce a displayed number goes through here, and every path that
 * can't gets INSUFFICIENT_DATA (or INTERVAL, for "we have a model but the
 * uncertainty band is too wide to show a point estimate") instead — never a
 * fabricated or heuristic-substituted probability.
 */
import type { ForecastDb } from './db.js'
import { buildFeatureSnapshot } from './featureSnapshot.js'
import type { MlForecastClient } from './mlForecastClient.js'

// Wider than this and a single-number display would overstate precision the
// model doesn't actually have — fall back to INTERVAL instead of PRECISE.
const MAX_INTERVAL_WIDTH_FOR_PRECISE_DISPLAY = 0.4

export interface ForecastDisplay {
  displayMode: 'PRECISE' | 'INTERVAL' | 'INSUFFICIENT_DATA'
  calibratedProbability?: number
  uncertaintyLow?: number
  uncertaintyHigh?: number
  rawScore?: number
  modelVersion?: string
  insufficientDataReason?: string
  featureSnapshotHash: string
}

export async function getClaimForecast(
  db: ForecastDb,
  mlClient: MlForecastClient,
  claimId: number,
  opts: { asOf?: Date; forecastDefinitionId?: number } = {},
): Promise<ForecastDisplay | null> {
  const asOf = opts.asOf ?? new Date()

  const def = opts.forecastDefinitionId
    ? await db.forecastDefinition.findFirst({ where: { id: opts.forecastDefinitionId } })
    : await db.forecastDefinition.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } })
  if (!def) return null

  const snapshot = await buildFeatureSnapshot(db, claimId, asOf, def)
  if (!snapshot) return null // claim not found, or didn't exist yet as of asOf

  const modelVersion = await db.modelVersion.findFirst({
    where: { forecastDefinitionId: def.id, isCurrent: true },
  })

  let result: ForecastDisplay

  if (!modelVersion) {
    result = {
      displayMode: 'INSUFFICIENT_DATA',
      insufficientDataReason: 'No trained model exists yet for this forecast definition.',
      featureSnapshotHash: snapshot.hash,
    }
  } else if (modelVersion.trainingDataSource !== 'db') {
    // The critical product rule this whole pipeline exists to enforce: a
    // displayed probability must be calibrated against RESOLVED HISTORICAL
    // OUTCOMES, not a synthetic stand-in. A synthetic model's nTestSamples
    // is a fabricated number (train_forecast.py can generate arbitrarily
    // many synthetic rows) — passing the sample-size check below on
    // synthetic data would satisfy the letter of "enough samples" while
    // violating the actual rule. This gate is checked BEFORE sample size,
    // and blocks display unconditionally regardless of how large
    // nTestSamples is.
    result = {
      displayMode: 'INSUFFICIENT_DATA',
      insufficientDataReason:
        'The current model is trained on synthetic data only — no calibrated probability can be shown until enough resolved real outcomes exist to train on.',
      featureSnapshotHash: snapshot.hash,
    }
  } else if (modelVersion.nTestSamples < modelVersion.minSampleSizeForPrecise) {
    result = {
      displayMode: 'INSUFFICIENT_DATA',
      insufficientDataReason: `Model was evaluated on only ${modelVersion.nTestSamples} held-out samples (need ${modelVersion.minSampleSizeForPrecise}+) — not enough to trust an out-of-sample estimate.`,
      featureSnapshotHash: snapshot.hash,
    }
  } else {
    const scored = await mlClient
      .score({ features: snapshot.features, forecastDefinitionVersion: def.version })
      .catch(() => null)

    if (!scored) {
      result = {
        displayMode: 'INSUFFICIENT_DATA',
        insufficientDataReason: 'Forecasting service unavailable.',
        featureSnapshotHash: snapshot.hash,
      }
    } else {
      const intervalWidth = scored.uncertaintyHigh - scored.uncertaintyLow
      const tooWide = intervalWidth > MAX_INTERVAL_WIDTH_FOR_PRECISE_DISPLAY
      result = {
        displayMode: tooWide ? 'INTERVAL' : 'PRECISE',
        calibratedProbability: scored.calibratedProbability,
        uncertaintyLow: scored.uncertaintyLow,
        uncertaintyHigh: scored.uncertaintyHigh,
        rawScore: scored.rawScore,
        modelVersion: scored.modelVersion,
        featureSnapshotHash: snapshot.hash,
      }
    }
  }

  await db.claimForecast.create({
    data: {
      claimId,
      forecastDefinitionId: def.id,
      modelVersionId: modelVersion?.id ?? null,
      predictionTimestamp: asOf,
      featureSnapshot: snapshot.features,
      featureSnapshotHash: snapshot.hash,
      rawScore: result.rawScore ?? null,
      calibratedProbability: result.calibratedProbability ?? null,
      uncertaintyLow: result.uncertaintyLow ?? null,
      uncertaintyHigh: result.uncertaintyHigh ?? null,
      displayMode: result.displayMode,
      insufficientDataReason: result.insufficientDataReason ?? null,
    },
  })

  return result
}
