import { Queue } from 'bullmq'
import { createRedisConnection } from './connection.js'

export type IngestJobData =
  | { source: 'sportmonks' }
  | { source: 'rss'; feedUrl: string; sourceName: string }
  | { source: 'apifootball' }

export type ScoreJobData = { rumourId: number }

export type DedupeJobData = {
  playerId: number
  fromClubId: number
  toClubId: number
  newRumourId: number
}

const defaultOpts = { connection: createRedisConnection() }

export const ingestQueue = new Queue<IngestJobData>('ingest', {
  ...defaultOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
})

export const scoreQueue = new Queue<ScoreJobData>('score', {
  ...defaultOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2_000 },
    removeOnComplete: 100,
  },
})

export const dedupeQueue = new Queue<DedupeJobData>('dedupe', {
  ...defaultOpts,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: 100,
  },
})
