import { randomBytes, createHash, timingSafeEqual } from 'crypto'

// Raw key material is never stored (docs/public-beta-readiness-audit.md).
// `prefix` is the public, indexed lookup column — safe to keep visible
// forever, shown masked in the owner-visible listing. `secret` is shown
// exactly once, at creation, and only its SHA-256 hash is persisted.
//
// SHA-256, not bcrypt: the secret is high-entropy (24 random bytes,
// machine-generated, never user-chosen), so it needs no slow key-derivation
// function — and critically, it must be looked up *deterministically* by
// hash (keyed on `prefix`, then hash-compared), which a per-row-salted
// bcrypt hash can't support without scanning every row.
export interface GeneratedApiKey {
  prefix: string
  secret: string
  fullKey: string
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(6).toString('hex')
  const secret = randomBytes(24).toString('hex')
  return { prefix, secret, fullKey: `${prefix}.${secret}` }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

// Constant-time comparison — a `===`/string-equality check on the hash
// would leak timing information about how many leading bytes matched.
export function secretMatches(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (candidate.length !== stored.length) return false
  return timingSafeEqual(candidate, stored)
}

export function parsePresentedKey(fullKey: string): { prefix: string; secret: string } | null {
  const idx = fullKey.indexOf('.')
  if (idx <= 0 || idx === fullKey.length - 1) return null
  return { prefix: fullKey.slice(0, idx), secret: fullKey.slice(idx + 1) }
}

export function maskPrefix(prefix: string): string {
  const visible = prefix.slice(0, 4)
  return `${visible}${'*'.repeat(Math.max(prefix.length - visible.length, 4))}`
}
