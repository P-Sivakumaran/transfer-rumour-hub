import { generateApiKey, hashSecret, parsePresentedKey, secretMatches, maskPrefix } from './hashing.js'
import type { ApiKeyDb, ApiKeyRow, ApiKeyScope, ApiKeyUsageDb, ApiEndpointCategory, ApiResponseClass } from './db.js'

export interface CreateApiKeyInput {
  userId: number
  name: string
  scopes: ApiKeyScope[]
  expiresAt?: Date | null
}

export interface CreatedApiKey {
  id: number
  name: string
  scopes: ApiKeyScope[]
  keyPrefix: string
  plaintextKey: string
  createdAt: Date
  expiresAt: Date | null
}

// The only place the plaintext key ever exists after this call returns is
// in the HTTP response body — never persisted, never logged. See
// hashing.ts for why SHA-256 over bcrypt.
export async function createApiKey(db: ApiKeyDb, input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const { prefix, secret, fullKey } = generateApiKey()
  const row = await db.apiKey.create({
    data: {
      userId: input.userId,
      keyPrefix: prefix,
      secretHash: hashSecret(secret),
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
    },
  })
  return { id: row.id, name: row.name, scopes: row.scopes, keyPrefix: row.keyPrefix, plaintextKey: fullKey, createdAt: row.createdAt, expiresAt: row.expiresAt }
}

export interface MaskedApiKey {
  id: number
  name: string
  scopes: ApiKeyScope[]
  maskedPrefix: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
}

// Owner-visible listing — masked prefix and metadata only, never secret
// material (there's nothing to show even if we wanted to: only the hash is
// stored).
export async function listApiKeys(db: ApiKeyDb, userId: number): Promise<MaskedApiKey[]> {
  const rows = await db.apiKey.findMany({ where: { userId } })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scopes: r.scopes,
    maskedPrefix: maskPrefix(r.keyPrefix),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
  }))
}

export type RevokeResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' }

// Admin-only per the task spec — see routes/admin.ts's
// POST /admin/api-keys/:id/revoke, the only call site.
export async function revokeApiKey(db: ApiKeyDb, keyId: number): Promise<RevokeResult> {
  const existing = await db.apiKey.findFirst({ where: { id: keyId } })
  if (!existing) return { ok: false, reason: 'NOT_FOUND' }
  await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } })
  return { ok: true }
}

export type ApiKeyRejectionReason = 'INVALID' | 'EXPIRED' | 'REVOKED' | 'WRONG_TIER' | 'MISSING_SCOPE' | 'FEATURE_DISABLED'

export type AuthResult =
  | { ok: true; key: ApiKeyRow }
  | { ok: false; status: 401; reason: 'INVALID' | 'EXPIRED' | 'REVOKED'; keyId?: number }
  | { ok: false; status: 403; reason: 'WRONG_TIER' | 'MISSING_SCOPE' | 'FEATURE_DISABLED'; keyId: number }

// Every branch returns a generic-enough `reason` that the caller (
// apiKeys/middleware.ts) can produce a non-enumerating HTTP response
// (identical 401 body whether the key is unknown, wrong-secret, expired,
// or revoked — see docs/research-api.md) while still logging the specific
// reason internally via OperationalEvent, which is not attacker-visible.
export async function authenticateApiKey(
  db: ApiKeyDb,
  presentedKey: string,
  requiredScope: ApiKeyScope,
  featureEnabled: boolean,
): Promise<AuthResult> {
  const parsed = parsePresentedKey(presentedKey)
  if (!parsed) return { ok: false, status: 401, reason: 'INVALID' }

  const key = await db.apiKey.findUnique({ where: { keyPrefix: parsed.prefix } })
  if (!key) return { ok: false, status: 401, reason: 'INVALID' }

  if (!secretMatches(parsed.secret, key.secretHash)) return { ok: false, status: 401, reason: 'INVALID', keyId: key.id }
  if (key.revokedAt) return { ok: false, status: 401, reason: 'REVOKED', keyId: key.id }
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return { ok: false, status: 401, reason: 'EXPIRED', keyId: key.id }

  // Re-checked live, not cached on the key row at creation time — a
  // downgraded owner (e.g. entitlement later revoked) loses API access
  // immediately, same "re-read per request" reasoning as requireEntitlement
  // and requireAdmin.
  const owner = await db.user.findUnique({ where: { id: key.userId }, select: { tier: true } })
  if (!owner || owner.tier !== 'RESEARCH') return { ok: false, status: 403, reason: 'WRONG_TIER', keyId: key.id }

  if (!key.scopes.includes(requiredScope)) return { ok: false, status: 403, reason: 'MISSING_SCOPE', keyId: key.id }
  if (!featureEnabled) return { ok: false, status: 403, reason: 'FEATURE_DISABLED', keyId: key.id }

  return { ok: true, key }
}

export interface RecordUsageInput {
  apiKeyId: number | null
  endpointCategory: ApiEndpointCategory
  responseClass: ApiResponseClass
  rateLimitState?: object
}

// Privacy-minimized by construction — the parameter type has no field for
// a request body, raw URL, or claim/player ID, so there's nothing for a
// caller to accidentally pass through. See db.ts's ApiKeyUsageEvent shape.
export async function recordApiKeyUsage(db: ApiKeyUsageDb, input: RecordUsageInput): Promise<void> {
  await db.apiKeyUsageEvent.create({ data: input })
}
