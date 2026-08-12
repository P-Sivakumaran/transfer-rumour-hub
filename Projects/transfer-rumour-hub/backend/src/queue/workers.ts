import { Worker } from 'bullmq'
import { PrismaClient, RumourStatus, SourceType } from '@prisma/client'
import { createRedisConnection } from './connection.js'
import {
  scoreQueue, dedupeQueue, enrichQueue,
  type IngestJobData, type ScoreJobData, type DedupeJobData, type EnrichJobData, type PlayerSyncJobData,
} from './queues.js'
import { fetchLatestRumours } from '../ingestion/sportmonks.js'
import { fetchRSSSignals, RSS_FEEDS } from '../ingestion/sources/rss.js'
import { fetchApiFootballTransfers } from '../ingestion/sources/apifootball.js'
import { extractRumoursFromText, getEntities } from '../ingestion/entityMatcher.js'
import { computeScore } from '../scoring/likelihoodEngine.js'
import { broadcast } from '../sse/broadcaster.js'
import { detectOutcome, applyOutcome } from '../ingestion/outcomeDetector.js'
import { runPlayerEnrichment } from '../ingestion/enrichment.js'
import { runPlayerClubSyncWithPrisma } from '../ingestion/playerClubSync.js'

const prisma = new PrismaClient()

async function ensureSource(name: string, reliability: number): Promise<number> {
  const existing = await prisma.source.findFirst({ where: { name } })
  if (existing) return existing.id
  const created = await prisma.source.create({
    data: { name, type: SourceType.AGGREGATOR, reliabilityScore: reliability },
  })
  return created.id
}

// ─── Contradiction check ─────────────────────────────────────────────────────

async function linkContradiction(newRumourId: number, playerId: number, toClubId: number): Promise<number | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const conflicting = await prisma.rumour.findFirst({
    where: {
      playerId,
      toClubId: { not: toClubId },
      status: { in: [RumourStatus.PENDING, RumourStatus.HOT] },
      rumourDate: { gte: thirtyDaysAgo },
      id: { not: newRumourId },
    },
    orderBy: { computedLikelihood: 'desc' },
  })
  if (!conflicting) return null

  await prisma.rumour.update({
    where: { id: newRumourId },
    data: { contradicts: conflicting.id },
  })
  console.log(`[workers] Contradiction: rumour ${newRumourId} contradicts ${conflicting.id} (same player, different destination)`)
  return conflicting.id
}

// ─── Outcome fallback: handles confirmation headlines with only 1 club ───────
// "Mastantuono joins Fiorentina on loan" → no fromClub → 0 candidates → this fires

async function applyOutcomeFallback(
  signal: import('../ingestion/sources/rss.js').RSSRumourSignal,
  outcome: 'COMPLETED' | 'FAILED',
): Promise<void> {
  const { players, clubs } = await getEntities()
  const lowerText = signal.rawText.toLowerCase()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const mentionedPlayerIds = players
    .filter((p) => {
      const parts = p.name.toLowerCase().split(/\s+/)
      return parts.some((part) => part.length >= 4 && lowerText.includes(part))
    })
    .map((p) => p.id)

  const mentionedClubIds = clubs
    .filter((c) => c.name.length >= 4 && lowerText.includes(c.name.toLowerCase()))
    .map((c) => c.id)

  if (!mentionedPlayerIds.length || !mentionedClubIds.length) return

  const matching = await prisma.rumour.findMany({
    where: {
      playerId: { in: mentionedPlayerIds },
      toClubId: { in: mentionedClubIds },
      status: { in: [RumourStatus.PENDING, RumourStatus.HOT] },
      rumourDate: { gte: thirtyDaysAgo },
    },
  })

  for (const r of matching) {
    await applyOutcome(r.id, outcome, prisma)
    broadcast('rumour:updated', { id: r.id, status: outcome })
    console.log(`[outcome:fallback] Applied ${outcome} to rumour ${r.id} via text mention`)
  }
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
    const enrichedPlayers = new Set<number>() // avoid duplicate enrich jobs per batch

    for (const signal of signals) {
      // 0. Skip feed items we've already ingested — RSS feeds re-serve the same
      // ~20-50 items on every poll, and without this check every cron tick
      // re-runs entity extraction on identical text, flooding rumours with dupes.
      if (signal.link) {
        const alreadySeen = await prisma.rawSignal.findFirst({ where: { link: signal.link } })
        if (alreadySeen) continue
      }

      // 1. Persist raw signal
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

      // 2. Detect outcome signal (here we go, confirmed, deal off, etc.)
      const detectedOutcome = detectOutcome(signal.rawText)

      // 3. Extract entities and match/create rumours
      const candidates = await extractRumoursFromText(signal.headline, signal.summary)

      const reliability = signal.impliedReliability ?? defaultReliability
      const sourceId = await ensureSource(sourceName, reliability)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      let matchedRumourId: number | null = null

      for (const candidate of candidates) {
        const existing = await prisma.rumour.findFirst({
          where: {
            playerId: candidate.playerId,
            fromClubId: candidate.fromClubId,
            toClubId: candidate.toClubId,
            rumourDate: { gte: sevenDaysAgo },
          },
        })

        if (existing) {
          matchedRumourId = existing.id
          await prisma.rumour.update({
            where: { id: existing.id },
            data: { distinctSourceCount: { increment: 1 } },
          })
          await scoreQueue.add('score', { rumourId: existing.id })

          // Apply outcome to existing rumour if detected
          if (detectedOutcome) {
            await applyOutcome(existing.id, detectedOutcome, prisma)
            broadcast('rumour:updated', { id: existing.id, status: detectedOutcome })
          }
        } else {
          const rumour = await prisma.rumour.create({
            data: {
              playerId: candidate.playerId,
              fromClubId: candidate.fromClubId,
              fromClubInferred: candidate.fromClubInferred,
              toClubId: candidate.toClubId,
              sourceId,
              baseProbability: candidate.confidence,
              window: signal.window,
              rumourDate: signal.publishedAt,
              computedLikelihood: 0,
              notes: signal.headline,
              // Always start PENDING; applyOutcome below handles status + hitCount
              status: RumourStatus.PENDING,
            },
          })
          matchedRumourId = rumour.id
          await scoreQueue.add('score', { rumourId: rumour.id })

          // Apply outcome explicitly so hitCount/reliability are credited
          if (detectedOutcome) {
            await applyOutcome(rumour.id, detectedOutcome, prisma)
            broadcast('rumour:updated', { id: rumour.id, status: detectedOutcome })
          }

          // Check for contradictions with other rumours for the same player
          const contradictsId = await linkContradiction(rumour.id, candidate.playerId, candidate.toClubId)

          broadcast('rumour:new', {
            id: rumour.id,
            player: candidate.playerName,
            from: candidate.fromClubName,
            to: candidate.toClubName,
            source: sourceName,
            contradicted: contradictsId !== null,
          })
        }

        // Queue enrichment for auto-created players (once per player per ingest batch)
        if (candidate.autoCreated && !enrichedPlayers.has(candidate.playerId)) {
          enrichedPlayers.add(candidate.playerId)
          await enrichQueue.add('enrich', {
            playerId: candidate.playerId,
            playerName: candidate.playerName,
          }, {
            // Deduplicate by player id — don't enrich the same player twice in parallel
            jobId: `enrich-player-${candidate.playerId}`,
          })
        }

        matched++
      }

      // Outcome fallback: confirmation headlines that only name destination club
      // produce 0 candidates (need 2 clubs for tuple extraction) — look up by mention
      if (detectedOutcome && candidates.length === 0) {
        await applyOutcomeFallback(signal, detectedOutcome)
      }

      if (candidates.length > 0) {
        await prisma.rawSignal.update({
          where: { id: raw.id },
          data: { matched: true, rumourId: matchedRumourId },
        })
      }
    }

    console.log(`[worker:ingest] ${sourceName}: ${signals.length} signals, ${matched} matched`)
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

  // Don't overwrite a terminal outcome with a score recalculation
  if (
    rumour.status === RumourStatus.COMPLETED ||
    rumour.status === RumourStatus.FAILED ||
    rumour.status === RumourStatus.DENIED
  ) return

  const now = new Date()
  const contractEnd = rumour.player.contractEnd
  const monthsToExpiry = contractEnd
    ? (contractEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : null

  const { score } = await computeScore({
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

// ─── Enrich worker ──────────────────────────────────────────────────────────

async function processEnrich(job: { data: EnrichJobData }) {
  const { playerId, playerName } = job.data

  // Skip if already enriched recently (within 7 days)
  const player = await prisma.player.findUnique({ where: { id: playerId }, select: { enrichedAt: true } })
  if (player?.enrichedAt) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    if (player.enrichedAt > sevenDaysAgo) {
      console.log(`[worker:enrich] Skipping "${playerName}" — enriched ${player.enrichedAt.toISOString()}`)
      return
    }
  }

  await runPlayerEnrichment(playerId, playerName, prisma)
}

async function processPlayerSync(_job: { data: PlayerSyncJobData }) {
  console.log('[worker:player-sync] starting')
  const result = await runPlayerClubSyncWithPrisma(prisma)
  console.log(`[worker:player-sync] done — clubs=${result.clubs} players=${result.players}`)
  return result
}

// ─── Start all workers ──────────────────────────────────────────────────────

export function startWorkers(): void {
  const conn = createRedisConnection()
  new Worker<IngestJobData>('ingest', processIngest as any, { connection: conn, concurrency: 3 })
  new Worker<ScoreJobData>('score', processScore as any, { connection: conn, concurrency: 10 })
  new Worker<DedupeJobData>('dedupe', processDedupe as any, { connection: conn, concurrency: 2 })
  new Worker<EnrichJobData>('enrich', processEnrich as any, { connection: conn, concurrency: 1 }) // 1 at a time to be polite to Wikidata
  // concurrency 1 — a second overlapping run could race on the adopt-by-name reconciliation step
  new Worker<PlayerSyncJobData>('player-sync', processPlayerSync as any, { connection: conn, concurrency: 1 })
  console.log('[workers] Ingest, score, dedupe, enrich, player-sync workers started.')
}
