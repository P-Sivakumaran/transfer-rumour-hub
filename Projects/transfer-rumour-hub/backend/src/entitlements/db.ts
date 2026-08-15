import type { EntitlementTier } from './flags.js'

// Minimal injectable interface, same DI pattern as evidence/db.ts and
// forecasting/db.ts — lets middleware.ts and tests use an in-memory fake
// instead of a real PrismaClient.
export interface EntitlementDb {
  user: {
    findUnique: (args: { where: { id: number }; select: { tier: true } }) => Promise<{ tier: EntitlementTier } | null>
  }
}
