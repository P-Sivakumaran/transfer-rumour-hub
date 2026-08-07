/**
 * BullMQ v5 job scheduler — uses upsertJobScheduler (replaces deprecated repeat API).
 */
import { ingestQueue } from './queues.js'
import { RSS_FEEDS } from '../ingestion/sources/rss.js'

const _parsedMinutes = parseInt(process.env.RUMOUR_INGEST_INTERVAL_MINUTES ?? '30', 10)
const INTERVAL_MS =
  Number.isNaN(_parsedMinutes) || _parsedMinutes <= 0 ? 30 * 60 * 1000 : _parsedMinutes * 60 * 1000

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

  // Fire all sources immediately on startup
  await ingestQueue.add('sportmonks-boot', { source: 'sportmonks' })
  await ingestQueue.add('apifootball-boot', { source: 'apifootball' })
  for (const feed of RSS_FEEDS) {
    await ingestQueue.add(`rss-${feed.name}-boot`, {
      source: 'rss',
      feedUrl: feed.url,
      sourceName: feed.name,
    })
  }

  console.log(`[scheduler] Job schedulers registered — interval: ${INTERVAL_MS / 60000}m`)
}
