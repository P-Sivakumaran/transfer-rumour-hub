export type ApiKeyScope = 'RESEARCH_READ' | 'RESEARCH_EXPORT'
export type ApiEndpointCategory = 'HISTORICAL_CLAIMS' | 'EVIDENCE_METADATA'
export type ApiResponseClass = 'SUCCESS' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'RATE_LIMITED'

export interface ApiKeyRow {
  id: number
  userId: number
  keyPrefix: string
  secretHash: string
  name: string
  scopes: ApiKeyScope[]
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
}

// Minimal injectable interface, same DI pattern as evidence/db.ts,
// entitlements/db.ts, admin/db.ts.
export interface ApiKeyDb {
  apiKey: {
    create: (args: {
      data: { userId: number; keyPrefix: string; secretHash: string; name: string; scopes: ApiKeyScope[]; expiresAt: Date | null }
    }) => Promise<ApiKeyRow>
    findUnique: (args: { where: { keyPrefix: string } }) => Promise<ApiKeyRow | null>
    findFirst: (args: { where: { id: number } }) => Promise<ApiKeyRow | null>
    findMany: (args: { where: { userId: number } }) => Promise<ApiKeyRow[]>
    update: (args: { where: { id: number }; data: Partial<{ lastUsedAt: Date; revokedAt: Date }> }) => Promise<ApiKeyRow>
  }
  user: {
    findUnique: (args: { where: { id: number }; select: { tier: true } }) => Promise<{ tier: 'FREE' | 'PRO' | 'RESEARCH' } | null>
  }
}

export interface ApiKeyUsageDb {
  apiKeyUsageEvent: {
    create: (args: {
      data: { apiKeyId: number | null; endpointCategory: ApiEndpointCategory; responseClass: ApiResponseClass; rateLimitState?: object }
    }) => Promise<unknown>
  }
}
