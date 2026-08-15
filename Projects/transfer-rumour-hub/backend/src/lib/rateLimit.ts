import { Redis } from 'ioredis'
import type { Request, Response, NextFunction } from 'express'

// Reuses ioredis, already this repo's dependency for BullMQ
// (queue/connection.ts) — hoisted from the root package.json in this npm
// workspace, not backend/package.json's own dependency list, same
// established pattern. No rate-limiting library exists anywhere in this
// repo (checked before writing this), so this is a small hand-rolled fixed-
// window counter rather than a new dependency for one primitive.
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
let sharedClient: Redis | null = null
function client(): Redis {
  if (!sharedClient) {
    sharedClient = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: true })
    sharedClient.on('error', () => {
      // Swallowed here deliberately — checkRateLimit's own try/catch is
      // what decides open-vs-closed behavior; an unhandled 'error' event
      // would otherwise crash the process on a transient Redis blip.
    })
  }
  return sharedClient
}

export type RateLimitFailureMode = 'OPEN' | 'CLOSED'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: Date
}

// Fixed-window counter via INCR+EXPIRE. Not perfectly smooth (a burst
// straddling a window boundary can briefly exceed `limit` by up to 2x) but
// simple, correct enough for abuse-prevention on the low-frequency
// privileged routes this guards, and race-free per key (INCR is atomic in
// Redis) — good enough without adding a sliding-window Lua script.
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  failureMode: RateLimitFailureMode,
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`
  try {
    const redis = client()
    const count = await redis.incr(redisKey)
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds)
    }
    const ttl = await redis.ttl(redisKey)
    const resetAt = new Date(Date.now() + Math.max(ttl, 0) * 1000)
    return { allowed: count <= limit, remaining: Math.max(limit - count, 0), limit, resetAt }
  } catch (err) {
    // Redis unreachable — fail per the caller's declared policy rather than
    // throw. See docs/public-beta-readiness-audit.md §5: the admin-grant
    // route fails CLOSED (low-traffic, high-consequence); API-key request
    // rate limiting fails OPEN (a Redis outage blocking all Research API
    // reads is a worse operational outcome than temporarily-unlimited reads
    // of already-scoped data).
    console.error(`[rateLimit] Redis error for key "${key}", failing ${failureMode}:`, err)
    const resetAt = new Date(Date.now() + windowSeconds * 1000)
    return failureMode === 'CLOSED'
      ? { allowed: false, remaining: 0, limit, resetAt }
      : { allowed: true, remaining: limit, limit, resetAt }
  }
}

export interface RateLimitOptions {
  keyFn: (req: Request) => string
  limit: number
  windowSeconds: number
  failureMode: RateLimitFailureMode
}

export function rateLimitMiddleware(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await checkRateLimit(opts.keyFn(req), opts.limit, opts.windowSeconds, opts.failureMode)
    res.setHeader('X-RateLimit-Limit', String(result.limit))
    res.setHeader('X-RateLimit-Remaining', String(result.remaining))
    if (!result.allowed) {
      res.status(429).json({ error: 'Rate limit exceeded', resetAt: result.resetAt.toISOString() })
      return
    }
    next()
  }
}
