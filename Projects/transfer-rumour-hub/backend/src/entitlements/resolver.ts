import { ENTITLEMENTS, isFeatureEnabled, tierMeets, type EntitlementTier, type FeatureKey } from './flags.js'

export type EntitlementDenialReason = 'INSUFFICIENT_TIER' | 'FEATURE_DISABLED'

export interface EntitlementCheck {
  allowed: boolean
  requiredTier: EntitlementTier
  reason?: EntitlementDenialReason
}

// Two-layer check, tier first: a feature disabled globally reads the same
// to every tier ("temporarily disabled"), but if the requesting tier
// wouldn't qualify anyway, that's the more specific/actionable answer
// ("not on your plan") and takes priority.
export function checkEntitlement(userTier: EntitlementTier, featureKey: FeatureKey): EntitlementCheck {
  const requiredTier = ENTITLEMENTS[featureKey]

  if (!tierMeets(userTier, requiredTier)) {
    return { allowed: false, requiredTier, reason: 'INSUFFICIENT_TIER' }
  }
  if (!isFeatureEnabled(featureKey)) {
    return { allowed: false, requiredTier, reason: 'FEATURE_DISABLED' }
  }
  return { allowed: true, requiredTier }
}
