import { describe, it, expect } from 'vitest'
import { generateApiKey, hashSecret, secretMatches, parsePresentedKey, maskPrefix } from './hashing.js'

describe('generateApiKey', () => {
  it('produces a prefix and secret joined by a dot, both non-empty', () => {
    const { prefix, secret, fullKey } = generateApiKey()
    expect(prefix.length).toBeGreaterThan(0)
    expect(secret.length).toBeGreaterThan(0)
    expect(fullKey).toBe(`${prefix}.${secret}`)
  })

  it('generates distinct keys on each call', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.prefix).not.toBe(b.prefix)
    expect(a.secret).not.toBe(b.secret)
  })
})

describe('secretMatches', () => {
  it('matches the correct secret against its own hash', () => {
    const { secret } = generateApiKey()
    expect(secretMatches(secret, hashSecret(secret))).toBe(true)
  })

  it('rejects a wrong secret', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(secretMatches(a.secret, hashSecret(b.secret))).toBe(false)
  })

  it('does not throw on a malformed/short candidate — different length just fails', () => {
    expect(() => secretMatches('short', hashSecret(generateApiKey().secret))).not.toThrow()
    expect(secretMatches('short', hashSecret(generateApiKey().secret))).toBe(false)
  })
})

describe('parsePresentedKey', () => {
  it('splits a well-formed key on the first dot', () => {
    expect(parsePresentedKey('abc123.def456')).toEqual({ prefix: 'abc123', secret: 'def456' })
  })

  it('rejects a key with no dot', () => {
    expect(parsePresentedKey('nodothere')).toBeNull()
  })

  it('rejects a key with an empty prefix or empty secret', () => {
    expect(parsePresentedKey('.secret')).toBeNull()
    expect(parsePresentedKey('prefix.')).toBeNull()
  })
})

describe('maskPrefix', () => {
  it('keeps the first 4 characters visible and masks the rest', () => {
    const masked = maskPrefix('abcdef123456')
    expect(masked.startsWith('abcd')).toBe(true)
    expect(masked).not.toContain('123456')
  })
})
