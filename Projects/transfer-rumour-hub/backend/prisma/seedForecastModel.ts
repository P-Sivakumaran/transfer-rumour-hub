/**
 * Registers a ForecastDefinition + its ModelVersion in Postgres from the
 * metadata train_forecast.py just wrote. Separate script rather than
 * folded into seed.ts/seedExtra.ts — this reads an artifact that only
 * exists after a training run, so it can't be part of the base seed chain.
 * Run: tsx prisma/seedForecastModel.ts
 * (after: cd ../ml-service && source venv/bin/activate && python -m app.forecasting.train_forecast)
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

interface TrainingMetadata {
  version: string
  forecastDefinitionVersion: number
  trainingDataSource: string
  nTrainSamples: number
  nTestSamples: number
  trainStart: string | null
  trainEnd: string | null
  testStart: string | null
  testEnd: string | null
  brierScore: number
  logLoss: number
  calibrationCurve: unknown
}

async function main() {
  const metadataPath = join(__dirname, '../../ml-service/forecast_model_metadata.json')
  const metadata: TrainingMetadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))

  const definition = await prisma.forecastDefinition.upsert({
    where: { version: metadata.forecastDefinitionVersion },
    update: {},
    create: {
      version: metadata.forecastDefinitionVersion,
      horizonDays: 30,
      description: 'Will this claim receive an official club confirmation within 30 days or before the transfer window closes?',
    },
  })

  // Demote any previously-current model for this definition — isCurrent is
  // exclusive per definition, enforced here rather than with a DB
  // constraint (a partial unique index on (forecastDefinitionId) WHERE
  // isCurrent would work too, but this keeps the invariant in one
  // reviewable place rather than split between schema and app code).
  await prisma.modelVersion.updateMany({
    where: { forecastDefinitionId: definition.id, isCurrent: true },
    data: { isCurrent: false },
  })

  const modelVersion = await prisma.modelVersion.upsert({
    where: { version: metadata.version },
    update: {},
    create: {
      forecastDefinitionId: definition.id,
      version: metadata.version,
      trainingDataSource: metadata.trainingDataSource,
      nTrainSamples: metadata.nTrainSamples,
      nTestSamples: metadata.nTestSamples,
      trainStart: metadata.trainStart ? new Date(metadata.trainStart) : null,
      trainEnd: metadata.trainEnd ? new Date(metadata.trainEnd) : null,
      testStart: metadata.testStart ? new Date(metadata.testStart) : null,
      testEnd: metadata.testEnd ? new Date(metadata.testEnd) : null,
      brierScore: metadata.brierScore,
      logLoss: metadata.logLoss,
      calibrationCurve: metadata.calibrationCurve as any,
      isCurrent: true,
    },
  })

  console.log(`Registered ForecastDefinition v${definition.version} (id=${definition.id})`)
  console.log(`Registered ModelVersion ${modelVersion.version} as current (nTestSamples=${modelVersion.nTestSamples})`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
