// Feature-flag + entitlement-tier registry for the monetisation proposal
// (docs/monetisation-proposal.md). Two independent layers, deliberately
// kept separate rather than collapsed into one boolean:
//
//   - ENTITLEMENTS: which tier a feature requires at all.
//   - FEATURE_FLAGS: whether a feature is currently switched on, globally,
//     regardless of tier — a kill switch, not a plan.
//
// A user can be entitled by tier but still see the feature disabled (e.g.
// CSV_EXPORT_WATCHLIST — a Pro user can't export until the data-licensing
// question in docs/monetisation-proposal.md is resolved and someone flips
// the flag). The resolver in resolver.ts reports which layer denied, so UI
// copy can say "not on your plan" vs "temporarily disabled" instead of one
// generic "no."
//
// No database table for flags — env-var overrides only, same
// works-or-gracefully-degrades pattern as ML_SCORING_URL/STRIPE_SECRET_KEY
// elsewhere in this codebase. A flag-management admin UI is out of scope:
// this is about validating the packaging proposal, not shipping a flag
// platform.

export type EntitlementTier = 'FREE' | 'PRO' | 'RESEARCH'
// Only MANUAL is ever written by this codebase — see User.entitlementSource
// in schema.prisma. Typed here (not previously) because admin/db.ts and
// admin/auditService.ts need it for AdminAuditEvent's typed shape.
export type EntitlementSource = 'MANUAL'

export type FeatureKey =
  | 'UNLIMITED_WATCHLIST'
  | 'INSTANT_ALERTS'
  | 'FORECAST_HISTORY'
  | 'ADVANCED_FILTERS'
  | 'CSV_EXPORT_WATCHLIST'
  | 'API_ACCESS'
  | 'HISTORICAL_DATASETS'
  | 'PROVENANCE_BULK_EXPORT'

const TIER_RANK: Record<EntitlementTier, number> = { FREE: 0, PRO: 1, RESEARCH: 2 }

export function tierMeets(userTier: EntitlementTier, required: EntitlementTier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[required]
}

// Minimum tier required for each feature.
export const ENTITLEMENTS: Record<FeatureKey, EntitlementTier> = {
  UNLIMITED_WATCHLIST: 'PRO',
  INSTANT_ALERTS: 'PRO',
  FORECAST_HISTORY: 'PRO',
  ADVANCED_FILTERS: 'PRO',
  CSV_EXPORT_WATCHLIST: 'PRO',
  API_ACCESS: 'RESEARCH',
  HISTORICAL_DATASETS: 'RESEARCH',
  PROVENANCE_BULK_EXPORT: 'RESEARCH',
}

// Global on/off, independent of tier. CSV_EXPORT_WATCHLIST defaults OFF —
// see docs/monetisation-proposal.md "Data licensing": whether re-exporting
// Sportmonks-derived data is compliant with the current data license has
// not been reviewed, so the switch stays off until it has been, even for
// an entitled Pro user. Same reasoning, greater severity, for the two
// Research bulk-data flags.
const DEFAULT_ENABLED: Record<FeatureKey, boolean> = {
  UNLIMITED_WATCHLIST: true,
  INSTANT_ALERTS: true,
  FORECAST_HISTORY: true,
  ADVANCED_FILTERS: true,
  CSV_EXPORT_WATCHLIST: false,
  API_ACCESS: true,
  HISTORICAL_DATASETS: false,
  PROVENANCE_BULK_EXPORT: false,
}

function envOverride(key: FeatureKey): boolean | undefined {
  const raw = process.env[`FEATURE_${key}`]
  if (raw === undefined) return undefined
  return raw === 'true' || raw === '1'
}

export function isFeatureEnabled(key: FeatureKey): boolean {
  return envOverride(key) ?? DEFAULT_ENABLED[key]
}

export const FREE_WATCHLIST_LIMIT = 5
