/**
 * BullMQ v5 job scheduler — uses upsertJobScheduler (replaces deprecated repeat API).
 */
import { ingestQueue, playerSyncQueue, maintenanceQueue } from './queues.js'
import { RSS_FEEDS } from '../ingestion/sources/rss.js'

const _parsedMinutes = parseInt(process.env.RUMOUR_INGEST_INTERVAL_MINUTES ?? '30', 10)
const INTERVAL_MS =
  Number.isNaN(_parsedMinutes) || _parsedMinutes <= 0 ? 30 * 60 * 1000 : _parsedMinutes * 60 * 1000

const _parsedHours = parseInt(process.env.PLAYER_SYNC_INTERVAL_HOURS ?? '24', 10)
const PLAYER_SYNC_INTERVAL_MS =
  Number.isNaN(_parsedHours) || _parsedHours <= 0 ? 24 * 60 * 60 * 1000 : _parsedHours * 60 * 60 * 1000

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000 // daily, per task spec — not env-configurable (retention *days* is; the run *cadence* isn't)

export async function scheduleRecurringJobs(): Promise<void> {
  // upsertJobScheduler is idempotent — safe to call on every startup
  await ingestQueue.upsertJobScheduler(
    'sportmonks-recurring',
    { every: INTERVAL_MS },
    { name: 'sportmonks', data: { source: 'sportmonks' } },
  )

  await ingestQueue.upsertJobScheduler(
    'apifootball-recurring',
    { every: INTERVAL_MS },
    { name: 'apifootball', data: { source: 'apifootball' } },
  )

  for (const feed of RSS_FEEDS) {
    await ingestQueue.upsertJobScheduler(
      `rss-${feed.name}-recurring`,
      { every: INTERVAL_MS },
      { name: `rss-${feed.name}`, data: { source: 'rss', feedUrl: feed.url, sourceName: feed.name } },
    )
  }

  await playerSyncQueue.upsertJobScheduler(
    'player-sync-recurring',
    { every: PLAYER_SYNC_INTERVAL_MS },
    { name: 'player-sync', data: {} },
  )

  // Public-beta readiness (2026-08-14) — ProductEvent retention purge.
  // See analytics/retention.ts / docs/data-retention.md.
  await maintenanceQueue.upsertJobScheduler(
    'purge-product-events-recurring',
    { every: PURGE_INTERVAL_MS },
    { name: 'purge-product-events', data: { task: 'purge-product-events' } },
  )

  // upsertJobScheduler only ever adds/updates — it never removes a scheduler
  // for a feed that's since been renamed or deleted from RSS_FEEDS. Found
  // live (2026-08-13): "Goal.com" and "Football365" kept firing every
  // interval and 404ing forever, long after they'd been removed from the
  // source array, because their `rss-<name>-recurring` schedulers were still
  // sitting in Redis from whenever they were first registered. Sweep those
  // orphans out on every boot instead of leaving them to run forever.
  const currentRssSchedulerIds = new Set(RSS_FEEDS.map((f) => `rss-${f.name}-recurring`))
  const existingSchedulers = await ingestQueue.getJobSchedulers()
  for (const s of existingSchedulers) {
    if (s.key.startsWith('rss-') && s.key.endsWith('-recurring') && !currentRssSchedulerIds.has(s.key)) {
      await ingestQueue.removeJobScheduler(s.key)
      console.log(`[scheduler] Removed orphaned RSS job scheduler: ${s.key}`)
    }
  }

  // Fire all sources immediately on startup
  await ingestQueue.add('sportmonks-boot', { source: 'sportmonks' })
  await playerSyncQueue.add('player-sync-boot', {})
  await ingestQueue.add('apifootball-boot', { source: 'apifootball' })
  // Purge is idempotent (runRetentionPurge only ever deletes rows already
  // past the cutoff) — safe to also fire once on boot rather than waiting
  // up to 24h for the first scheduled run.
  await maintenanceQueue.add('purge-product-events-boot', { task: 'purge-product-events' })
  for (const feed of RSS_FEEDS) {
    await ingestQueue.add(`rss-${feed.name}-boot`, {
      source: 'rss',
      feedUrl: feed.url,
      sourceName: feed.name,
    })
  }

  console.log(
    `[scheduler] Job schedulers registered — ingest interval: ${INTERVAL_MS / 60000}m, player-sync interval: ${PLAYER_SYNC_INTERVAL_MS / 3600000}h`,
  )
}
