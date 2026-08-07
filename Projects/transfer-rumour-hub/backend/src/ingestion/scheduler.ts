import cron from 'node-cron'
import { PrismaClient, RumourStatus } from '@prisma/client'
import { fetchLatestRumours } from './sportmonks.js'
import { computeScore } from '../scoring/likelihoodEngine.js'
import { broadcast } from '../sse/broadcaster.js'

const prisma = new PrismaClient()

async function recomputeAllLikelihoods(): Promise<void> {
  const rumours = await prisma.rumour.findMany({
    where: { status: { in: [RumourStatus.PENDING, RumourStatus.HOT] } },
    include: {
      player: true,
      source: true,
      fromClub: true,
      toClub: true,
    },
  })

  for (const r of rumours) {
    const now = new Date()
    const contractEnd = r.player.contractEnd
    const monthsToExpiry = contractEnd
      ? (contractEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      : null

    const { score } = computeScore({
      sourceReliability: r.source.reliabilityScore,
      monthsToContractExpiry: monthsToExpiry,
      reportedFeeMin: r.reportedFeeMin,
      reportedFeeMax: r.reportedFeeMax,
      marketValue: r.player.marketValue,
      clubNeedScore: 0.6, // stub — replace with real club need lookup
      distinctSourceCount: r.distinctSourceCount,
      baseProbability: r.baseProbability,
    })

    const newStatus: RumourStatus = score >= 70 ? RumourStatus.HOT : RumourStatus.PENDING

    const updated = await prisma.rumour.update({
      where: { id: r.id },
      data: { computedLikelihood: score, status: newStatus, updatedAt: now },
    })

    await prisma.rumourHistory.create({
      data: { rumourId: r.id, computedLikelihood: score, status: newStatus, recordedAt: now },
    })

    broadcast('rumour:updated', {
      id: updated.id,
      computedLikelihood: updated.computedLikelihood,
      status: updated.status,
    })
  }
  console.log(`[scheduler] Recomputed ${rumours.length} rumours.`)
}

async function ingestNewRumours(): Promise<void> {
  const rumours = await fetchLatestRumours()
  let created = 0

  for (const r of rumours) {
    const player = await prisma.player.findFirst({ where: { externalId: r.playerExternalId } })
    const fromClub = await prisma.club.findFirst({ where: { externalId: r.fromClubExternalId } })
    const toClub = await prisma.club.findFirst({ where: { externalId: r.toClubExternalId } })
    const source = await prisma.source.findFirst({ where: { name: 'Sportmonks Aggregator' } })

    if (!player || !fromClub || !toClub || !source) continue

    const existing = await prisma.rumour.findUnique({ where: { externalId: r.externalId } })
    if (existing) continue

    await prisma.rumour.create({
      data: {
        externalId: r.externalId,
        playerId: player.id,
        fromClubId: fromClub.id,
        toClubId: toClub.id,
        sourceId: source.id,
        reportedFeeMin: r.reportedFeeMin,
        reportedFeeMax: r.reportedFeeMax,
        currency: r.currency,
        baseProbability: r.baseProbability,
        window: r.window,
        rumourDate: r.rumourDate,
        computedLikelihood: 0,
      },
    })
    created++
  }

  console.log(`[scheduler] Ingested ${created} new rumours.`)
  broadcast('rumours:ingested', { count: created })
}

export function startScheduler(): void {
  const intervalMinutes = parseInt(process.env.RUMOUR_INGEST_INTERVAL_MINUTES ?? '30', 10)
  const cronExpr = `*/${intervalMinutes} * * * *`

  cron.schedule(cronExpr, async () => {
    try {
      await ingestNewRumours()
      await recomputeAllLikelihoods()
    } catch (err) {
      console.error('[scheduler] Error:', err)
    }
  })

  // Run once on startup
  setImmediate(async () => {
    try {
      await recomputeAllLikelihoods()
    } catch (err) {
      console.error('[scheduler] Startup recompute failed:', err)
    }
  })

  console.log(`[scheduler] Started — running every ${intervalMinutes} minutes.`)
}
