// Transparent upgrade UI (requirement 4) — describes functionality only.
// No checkout: payment processing is explicitly out of scope for this
// implementation (docs/monetisation-proposal.md). Entitlements are granted
// manually today (see backend POST /admin/users/:id/entitlement); there is
// deliberately no "Buy now" button here yet.

const TIERS = [
  {
    name: 'Free',
    tagline: 'Everything you need to follow the market.',
    features: [
      'Current rumours',
      'Provenance and source labels on every claim',
      'Watchlist up to 5 players',
      'Delayed alerts',
      'Full methodology visibility',
    ],
  },
  {
    name: 'Supporter/Pro',
    tagline: 'For fans tracking a lot, closely.',
    features: [
      'Unlimited watchlist',
      'Instant alerts for confirmation, denial, or a large forecast move',
      'Full forecast history and probability-change timeline',
      'Advanced filters (source tier, league, window)',
      'CSV export of your own watchlist, where legally permitted',
    ],
  },
  {
    name: 'Research/API',
    tagline: 'For people building on top of the data.',
    features: [
      'Documented, rate-limited API access',
      'Provenance-root and evidence metadata',
      'Historical resolved-claim datasets',
      'Model-health and calibration metrics',
      'Explicit data-license and attribution terms',
    ],
  },
]

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-white">Plans</h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Every tier sees the same calibrated forecast, computed the same way. Upgrading changes how much history,
          how many watchlist slots, and how fast alerts arrive — never the number itself, and never what evidence is
          visible. Official confirmation is the only confirmed status; a forecast is always an estimate.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {TIERS.map((tier) => (
          <div key={tier.name} className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-lg font-semibold text-white">{tier.name}</h2>
            <p className="mt-1 text-xs text-slate-500">{tier.tagline}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-400">
              {tier.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-pitch-500" aria-hidden>
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
        Payment isn&apos;t live yet — plans are granted manually while this packaging is being validated. See{' '}
        <span className="font-mono">docs/monetisation-proposal.md</span> for the full reasoning, including why
        contradicting evidence and official denials are never restricted by tier.
      </p>
    </div>
  )
}
