/**
 * BullMQ v5 job scheduler — uses upsertJobScheduler (replaces deprecated repeat API).
 */
import { ingestQueue, playerSyncQueue } from './queues.js'
import { RSS_FEEDS } from '../ingestion/sources/rss.js'

const _parsedMinutes = parseInt(process.env.RUMOUR_INGEST_INTERVAL_MINUTES ?? '30', 10)
const INTERVAL_MS =
  Number.isNaN(_parsedMinutes) || _parsedMinutes <= 0 ? 30 * 60 * 1000 : _parsedMinutes * 60 * 1000

const _parsedHours = parseInt(process.env.PLAYER_SYNC_INTERVAL_HOURS ?? '24', 10)
const PLAYER_SYNC_INTERVAL_MS =
  Number.isNaN(_parsedHours) || _parsedHours <= 0 ? 24 * 60 * 60 * 1000 : _parsedHours * 60 * 60 * 1000

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

  // Fire all sources immediately on startup
  await ingestQueue.add('sportmonks-boot', { source: 'sportmonks' })
  await playerSyncQueue.add('player-sync-boot', {})
  await ingestQueue.add('apifootball-boot', { source: 'apifootball' })
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
