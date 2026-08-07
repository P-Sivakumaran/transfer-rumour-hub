import { Worker } from 'bullmq'
import { PrismaClient, RumourStatus, SourceType } from '@prisma/client'
import { createRedisConnection } from './connection.js'
import { scoreQueue, dedupeQueue, type IngestJobData, type ScoreJobData, type DedupeJobData } from './queues.js'
import { fetchLatestRumours } from '../ingestion/sportmonks.js'
import { fetchRSSSignals, RSS_FEEDS } from '../ingestion/sources/rss.js'
import { fetchApiFootballTransfers } from '../ingestion/sources/apifootball.js'
import { extractRumoursFromText } from '../ingestion/entityMatcher.js'
import { computeScore } from '../scoring/likelihoodEngine.js'
import { broadcast } from '../sse/broadcaster.js'

const prisma = new PrismaClient()

// Ensure a Source row exists for a feed name, returns its id
async function ensureSource(name: string, reliability: number): Promise<number> {
  const existing = await prisma.source.findFirst({ where: { name } })
  if (existing) return existing.id
  const created = await prisma.source.create({
    data: {
      name,
      type: SourceType.AGGREGATOR,
      reliabilityScore: reliability,
    },
  })
  return created.id
}

// ─── Ingest worker ─────────────────────────────────────────────────────────

async function processIngest(job: { data: IngestJobData }) {
  const { source } = job.data
  console.log(`[worker:ingest] source=${source}`)

  if (source === 'sportmonks') {
    const rumours = await fetchLatestRumours()
    for (const r of rumours) await upsertNormalizedRumour(r)
    return { processed: rumours.length }
  }

  if (source === 'apifootball') {
    const rumours = await fetchApiFootballTransfers()
    for (const r of rumours) await upsertNormalizedRumour(r)
    return { processed: rumours.length }
  }

  if (source === 'rss') {
    const { feedUrl, sourceName } = job.data as Extract<IngestJobData, { source: 'rss' }>
    const feedMeta = RSS_FEEDS.find((f) => f.name === sourceName)
    const defaultReliability = feedMeta?.defaultReliability ?? 0.50

    const signals = await fetchRSSSignals(feedUrl, sourceName)
    let matched = 0

    for (const signal of signals) {
      // 1. Persist raw signal regardless of match
      const raw = await prisma.rawSignal.create({
        data: {
          sourceName: signal.sourceName,
          feedUrl: signal.feedUrl,
          headline: signal.headline,
          summary: signal.summary,
          link: signal.link,
          publishedAt: signal.publishedAt,
          rawText: signal.rawText,
          impliedReliability: signal.impliedReliability,
          matched: false,
        },
      })

      // 2. Try to extract player/club entities and create rumours
      const candidates = await extractRumoursFromText(signal.headline, signal.summary)

      // Resolve source once per signal — same for all candidates
      const reliability = signal.impliedReliability ?? defaultReliability
      const sourceId = await ensureSource(sourceName, reliability)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      for (const candidate of candidates) {
        // Check for existing rumour to merge
        const existing = await prisma.rumour.findFirst({
          where: {
            playerId: candidate.playerId,
            fromClubId: candidate.fromClubId,
            toClubId: candidate.toClubId,
            rumourDate: { gte: sevenDaysAgo },
          },
        })

        if (existing) {
          await prisma.rumour.update({
            where: { id: existing.id },
            data: { distinctSourceCount: { increment: 1 } },
          })
          await scoreQueue.add('score', { rumourId: existing.id })
        } else {
          const rumour = await prisma.rumour.create({
            data: {
              playerId: candidate.playerId,
              fromClubId: candidate.fromClubId,
              toClubId: candidate.toClubId,
              sourceId,
              baseProbability: candidate.confidence,
              window: signal.window,
              rumourDate: signal.publishedAt,
              computedLikelihood: 0,
              notes: signal.headline,
            },
          })
          await scoreQueue.add('score', { rumourId: rumour.id })
          broadcast('rumour:new', {
            id: rumour.id,
            player: candidate.playerName,
            from: candidate.fromClubName,
            to: candidate.toClubName,
            source: sourceName,
          })
        }

        matched++
      }

      // Mark raw signal matched once, after all candidates processed
      if (candidates.length > 0) {
        await prisma.rawSignal.update({
          where: { id: raw.id },
          data: { matched: true },
        })
      }
    }

    console.log(`[worker:ingest] ${sourceName}: ${signals.length} signals, ${matched} matched to rumours`)
    broadcast('rss:signals', { source: sourceName, total: signals.length, matched })
    return { signals: signals.length, matched }
  }
}

async function upsertNormalizedRumour(r: Awaited<ReturnType<typeof fetchLatestRumours>>[0]) {
  const player = await prisma.player.findFirst({ where: { externalId: r.playerExternalId } })
  const fromClub = await prisma.club.findFirst({ where: { externalId: r.fromClubExternalId } })
  const toClub = await prisma.club.findFirst({ where: { externalId: r.toClubExternalId } })

  if (!player || !fromClub || !toClub) return

  const sourceId = await ensureSource('Sportmonks Aggregator', 0.70)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const existing = await prisma.rumour.findFirst({
    where: {
      playerId: player.id,
      fromClubId: fromClub.id,
      toClubId: toClub.id,
      rumourDate: { gte: sevenDaysAgo },
    },
  })

  if (existing) {
    await prisma.rumour.update({
      where: { id: existing.id },
      data: { distinctSourceCount: { increment: 1 } },
    })
    await dedupeQueue.add('merge', {
      playerId: player.id,
      fromClubId: fromClub.id,
      toClubId: toClub.id,
      newRumourId: existing.id,
    })
    await scoreQueue.add('score', { rumourId: existing.id })
    return
  }

  const rumour = await prisma.rumour.upsert({
    where: { externalId: r.externalId },
    update: {},
    create: {
      externalId: r.externalId,
      playerId: player.id,
      fromClubId: fromClub.id,
      toClubId: toClub.id,
      sourceId,
      reportedFeeMin: r.reportedFeeMin,
      reportedFeeMax: r.reportedFeeMax,
      currency: r.currency,
      baseProbability: r.baseProbability,
      window: r.window,
      rumourDate: r.rumourDate,
      computedLikelihood: 0,
    },
  })
  await scoreQueue.add('score', { rumourId: rumour.id })
  broadcast('rumour:new', { id: rumour.id })
}

// ─── Score worker ───────────────────────────────────────────────────────────

async function processScore(job: { data: ScoreJobData }) {
  const rumour = await prisma.rumour.findUnique({
    where: { id: job.data.rumourId },
    include: { player: true, source: true },
  })
  if (!rumour) return

  const now = new Date()
  const contractEnd = rumour.player.contractEnd
  const monthsToExpiry = contractEnd
    ? (contractEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : null

  const { score } = computeScore({
    sourceReliability: rumour.source?.reliabilityScore ?? 0.5,
    monthsToContractExpiry: monthsToExpiry,
    reportedFeeMin: rumour.reportedFeeMin,
    reportedFeeMax: rumour.reportedFeeMax,
    marketValue: rumour.player.marketValue,
    clubNeedScore: 0.6,
    distinctSourceCount: rumour.distinctSourceCount,
    baseProbability: rumour.baseProbability,
  })

  const newStatus: RumourStatus = score >= 70 ? RumourStatus.HOT : RumourStatus.PENDING

  await prisma.rumour.update({
    where: { id: rumour.id },
    data: { computedLikelihood: score, status: newStatus },
  })
  await prisma.rumourHistory.create({
    data: { rumourId: rumour.id, computedLikelihood: score, status: newStatus },
  })

  broadcast('rumour:updated', { id: rumour.id, computedLikelihood: score, status: newStatus })
  return { rumourId: rumour.id, score }
}

// ─── Dedupe worker ──────────────────────────────────────────────────────────

async function processDedupe(job: { data: DedupeJobData }) {
  console.log(`[worker:dedupe] Merged sources for rumour ${job.data.newRumourId}`)
}

// ─── Start all workers ──────────────────────────────────────────────────────

export function startWorkers(): void {
  const conn = createRedisConnection()
  new Worker<IngestJobData>('ingest', processIngest as any, { connection: conn, concurrency: 3 })
  new Worker<ScoreJobData>('score', processScore as any, { connection: conn, concurrency: 10 })
  new Worker<DedupeJobData>('dedupe', processDedupe as any, { connection: conn, concurrency: 2 })
  console.log('[workers] Ingest, score, dedupe workers started.')
}
