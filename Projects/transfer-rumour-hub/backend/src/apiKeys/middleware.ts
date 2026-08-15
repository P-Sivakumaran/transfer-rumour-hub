import type { Response, NextFunction, Request } from 'express'
import type { ApiKeyDb, ApiKeyScope, ApiKeyUsageDb, ApiEndpointCategory } from './db.js'
import { authenticateApiKey, recordApiKeyUsage } from './service.js'
import { isFeatureEnabled, type FeatureKey } from '../entitlements/flags.js'
import { checkRateLimit } from '../lib/rateLimit.js'
import { logOperationalEvent, type OperationalEventDb } from '../analytics/operationalEvents.js'
import type { CorrelatedRequest } from '../lib/correlationId.js'

export interface ApiKeyRequest extends Request {
  apiKey?: { id: number; userId: number; scopes: ApiKeyScope[] }
}

// Per-key rate limit, not per-route — abuse from one key shouldn't affect
// another key's budget. Fails OPEN on a Redis outage (see
// docs/public-beta-readiness-audit.md §5): blocking all Research API reads
// because Redis is briefly down is a worse operational outcome than
// temporarily-unlimited reads of these already-scoped, non-personal
// datasets.
const API_KEY_RATE_LIMIT = 100
const API_KEY_RATE_WINDOW_SECONDS = 60

export interface RequireApiKeyOptions {
  scope: ApiKeyScope
  featureKey: FeatureKey
  endpointCategory: ApiEndpointCategory
}

// Replaces the cookie-session + requireEntitlement gate that used to sit
// on /research/* (docs/public-beta-readiness-audit.md — "Research tier has
// no real API-key auth" was the flagged gap this closes). Every rejection
// path returns the same generic body per status class ("safe,
// non-enumerating error responses" — an attacker can't distinguish unknown
// key from wrong secret from expired from revoked from the HTTP response
// alone); the specific reason is only visible internally, via
// OperationalEvent.
export function requireApiKey(db: ApiKeyDb & ApiKeyUsageDb & OperationalEventDb, opts: RequireApiKeyOptions) {
  return async (req: ApiKeyRequest, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = (req as CorrelatedRequest).correlationId ?? null
    const header = req.header('authorization')
    const presented = header?.startsWith('Bearer ') ? header.slice(7).trim() : null

    if (!presented) {
      await logOperationalEvent(db, { eventType: 'API_KEY_REJECTED', reason: 'INVALID' }, correlationId)
      await recordApiKeyUsage(db, { apiKeyId: null, endpointCategory: opts.endpointCategory, responseClass: 'UNAUTHORIZED' })
      res.status(401).json({ error: 'Missing or invalid API key' })
      return
    }

    const result = await authenticateApiKey(db, presented, opts.scope, isFeatureEnabled(opts.featureKey))

    if (!result.ok) {
      if (result.status === 401) {
        await logOperationalEvent(db, { eventType: 'API_KEY_REJECTED', reason: result.reason, keyId: result.keyId }, correlationId)
        await recordApiKeyUsage(db, { apiKeyId: result.keyId ?? null, endpointCategory: opts.endpointCategory, responseClass: 'UNAUTHORIZED' })
        res.status(401).json({ error: 'Missing or invalid API key' })
        return
      }
      await logOperationalEvent(db, { eventType: 'API_KEY_REJECTED', reason: result.reason, keyId: result.keyId }, correlationId)
      await recordApiKeyUsage(db, { apiKeyId: result.keyId, endpointCategory: opts.endpointCategory, responseClass: 'FORBIDDEN' })
      res.status(403).json({ error: 'API key not authorized for this resource' })
      return
    }

    const rate = await checkRateLimit(`apikey:${result.key.id}`, API_KEY_RATE_LIMIT, API_KEY_RATE_WINDOW_SECONDS, 'OPEN')
    res.setHeader('X-RateLimit-Limit', String(rate.limit))
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining))
    if (!rate.allowed) {
      await logOperationalEvent(db, { eventType: 'API_KEY_RATE_LIMITED', keyId: result.key.id }, correlationId)
      await recordApiKeyUsage(db, {
        apiKeyId: result.key.id,
        endpointCategory: opts.endpointCategory,
        responseClass: 'RATE_LIMITED',
        rateLimitState: { remaining: rate.remaining, limit: rate.limit },
      })
      res.status(429).json({ error: 'Rate limit exceeded', resetAt: rate.resetAt.toISOString() })
      return
    }

    req.apiKey = { id: result.key.id, userId: result.key.userId, scopes: result.key.scopes }
    await logOperationalEvent(db, { eventType: 'API_KEY_ACCEPTED', keyId: result.key.id, scope: opts.scope }, correlationId)
    await recordApiKeyUsage(db, { apiKeyId: result.key.id, endpointCategory: opts.endpointCategory, responseClass: 'SUCCESS' })
    // Best-effort — a missed lastUsedAt bump shouldn't fail the request.
    db.apiKey.update({ where: { id: result.key.id }, data: { lastUsedAt: new Date() } }).catch(() => {})

    next()
  }
}
