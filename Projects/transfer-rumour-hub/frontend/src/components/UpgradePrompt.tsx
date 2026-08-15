'use client'

import Link from 'next/link'
import { clsx } from 'clsx'
import { api } from '@/lib/api'
import type { EntitlementTier } from '@/types'

interface Props {
  // What the copy describes — functionality only, never accuracy. See
  // docs/monetisation-proposal.md "Competitor / reputational risks":
  // upgrade copy must never imply a paying user gets better predictions.
  description: string
  requiredTier: EntitlementTier
  featureKey: string
  compact?: boolean
}

const TIER_LABEL: Record<EntitlementTier, string> = {
  FREE: 'Free',
  PRO: 'Supporter/Pro',
  RESEARCH: 'Research/API',
}

// Transparent upgrade UI stub (requirement 4). Describes what the tier
// unlocks and links to /pricing — no checkout, no payment provider (out of
// scope for this task, see docs/monetisation-proposal.md). Every instance
// fires UPGRADE_INTEREST_CLICKED so which feature prompted interest is
// measurable before any billing integration exists.
export default function UpgradePrompt({ description, requiredTier, featureKey, compact = false }: Props) {
  function onClick() {
    api.analytics.logEvent('UPGRADE_INTEREST_CLICKED', { featureKey })
  }

  return (
    <div
      className={clsx(
        'rounded-xl border border-slate-700/60 bg-slate-800/40',
        compact ? 'flex flex-wrap items-center justify-between gap-3 px-4 py-2.5' : 'space-y-2 p-4',
      )}
      data-testid="upgrade-prompt"
    >
      <p className="text-sm text-slate-400">{description}</p>
      <div className="flex items-center gap-3">
        <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {TIER_LABEL[requiredTier]}
        </span>
        <Link
          href="/pricing"
          onClick={onClick}
          className="rounded-lg bg-pitch-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-pitch-600"
        >
          See what&apos;s included →
        </Link>
      </div>
      <p className="text-[11px] text-slate-600">
        Forecasts are estimates, not confirmations — every tier sees the same calibrated probability. Upgrading
        changes access and speed, not the number itself.
      </p>
    </div>
  )
}
