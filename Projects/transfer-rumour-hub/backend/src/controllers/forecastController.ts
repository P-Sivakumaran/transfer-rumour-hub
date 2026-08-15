import type { Request, Response } from 'express'
import axios from 'axios'
import { PrismaClient } from '@prisma/client'
import { getClaimForecast } from '../forecasting/forecastService.js'
import { createMlForecastClient } from '../forecasting/mlForecastClient.js'
import type { ForecastDb } from '../forecasting/db.js'

const prisma = new PrismaClient()
const db = prisma as unknown as ForecastDb
const mlClient = createMlForecastClient()

// GET /claims/:id/forecast — the only endpoint that produces a displayed
// probability. Goes through getClaimForecast(), which is where every
// acceptance gate (requirement 5) lives.
export async function handleGetClaimForecast(req: Request, res: Response): Promise<void> {
  const claimId = parseInt(req.params.id, 10)
  if (Number.isNaN(claimId)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }

  const forecast = await getClaimForecast(db, mlClient, claimId)
  if (!forecast) {
    res.status(404).json({ error: 'Claim not found, or did not exist yet as of the prediction timestamp' })
    return
  }
  res.json(forecast)
}

export async function handleListForecastDefinitions(_req: Request, res: Response): Promise<void> {
  const definitions = await prisma.forecastDefinition.findMany({ orderBy: { version: 'desc' } })
  res.json(definitions)
}

// GET /forecast/model-health — requirement 5's model-health endpoint.
// Stored evaluation metrics (source of truth) plus a best-effort live ping
// to ml-service; the DB-backed data is still returned even if ml-service is
// down, since "is the model healthy" shouldn't itself go blank when the
// scoring service happens to be unreachable.
export async function handleModelHealth(_req: Request, res: Response): Promise<void> {
  const definitions = await prisma.forecastDefinition.findMany({
    where: { isActive: true },
    include: {
      modelVersions: {
        orderBy: { trainedAt: 'desc' },
        take: 5,
      },
    },
  })

  let mlServiceStatus: { reachable: boolean; detail?: unknown } = { reachable: false }
  const healthUrl = process.env.ML_FORECAST_URL?.replace(/\/score$/, '/health')
  if (healthUrl) {
    try {
      const { data } = await axios.get(healthUrl, {
        timeout: 1500,
        headers: process.env.ML_SERVICE_KEY ? { 'X-ML-Service-Key': process.env.ML_SERVICE_KEY } : undefined,
      })
      mlServiceStatus = { reachable: true, detail: data }
    } catch {
      mlServiceStatus = { reachable: false }
    }
  }

  res.json({
    definitions: definitions.map((def) => {
      const current = def.modelVersions.find((m) => m.isCurrent) ?? null
      return {
        id: def.id,
        version: def.version,
        horizonDays: def.horizonDays,
        currentModel: current
          ? {
              version: current.version,
              trainedAt: current.trainedAt,
              trainingDataSource: current.trainingDataSource,
              nTrainSamples: current.nTrainSamples,
              nTestSamples: current.nTestSamples,
              minSampleSizeForPrecise: current.minSampleSizeForPrecise,
              meetsMinSampleSize: current.nTestSamples >= current.minSampleSizeForPrecise,
              brierScore: current.brierScore,
              logLoss: current.logLoss,
              calibrationCurve: current.calibrationCurve,
            }
          : null,
        recentModelVersions: def.modelVersions.map((m) => ({
          version: m.version,
          trainedAt: m.trainedAt,
          trainingDataSource: m.trainingDataSource,
          brierScore: m.brierScore,
          logLoss: m.logLoss,
          isCurrent: m.isCurrent,
        })),
      }
    }),
    mlService: mlServiceStatus,
  })
}
