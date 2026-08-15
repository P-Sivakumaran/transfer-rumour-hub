# Monetisation proposal

Scope of this document: the business case and packaging for TransferHub's
first paid tiers. The accompanying implementation (this session) ships the
entitlement model, feature flags, server-side checks, upgrade UI stubs, and
event instrumentation needed to validate the proposal — **no payment
processing**. Nothing here is billable yet; entitlements are granted
manually (`User.tier` + `User.entitlementSource`), the same "works without
the provider" pattern `ML_SCORING_URL` and `STRIPE_SECRET_KEY` already use
elsewhere in this codebase (missing config degrades gracefully, doesn't
block the feature from existing in code).

## Target user segments

| Segment | Who | What they actually want |
|---|---|---|
| **Casual fan** | Follows 1-2 clubs, checks the feed occasionally during a window | The current rumour feed, provenance labels, doesn't need history or exports |
| **Engaged supporter** | Tracks specific players/clubs across a whole window, checks daily | Fast notification when something changes, more than 5 watched players, filtering by their specific interests |
| **Analyst / content creator** | Writes about transfers, needs to show their work | Rumour history, probability-change timeline, CSV export to build their own charts/threads |
| **Researcher / data journalist / academic** | Studies transfer-market dynamics, media reliability, forecasting | Bulk historical data, provenance/evidence metadata, model-health metrics, a documented API — not a browser session |

The three packaging tiers map directly to the last three rows. The casual
fan is deliberately never asked to pay — see "Free vs paid value" below for
why that's a business decision, not just a growth-hack default.

## Free vs paid value

The free tier is not a stripped-down demo. It is the **entire trust-critical
surface**: rumours, provenance/source labels, methodology, and — this is
the load-bearing invariant, not a courtesy — **official denials and
contradicting evidence are never gated behind a paywall.**
`ClaimDetail.officialDenial` and any `EvidenceItem` with
`evidenceDirection: CONTRADICTS` render in `WhyThisForecast` and
`EvidenceTimeline` for every user, logged in or not, free or paid. Making
"tell me this is wrong" a paid feature would be the single fastest way to
destroy the credibility the whole product is built on. This is enforced in
code, not just policy — the entitlement checks added this session touch
*history*, *instant delivery*, *bulk export*, and *advanced filtering*.
Nothing touches which evidence is visible on a claim.

What's actually paid is **convenience and depth at scale**, not access to
the truth:

- **Free**: see what's true now, understand why, watch a handful of things,
  get alerted eventually.
- **Pro**: watch as many things as you want, get alerted the moment
  something changes, see how a forecast got here (not just where it is
  now), export your own data.
- **Research/API**: don't use the browser at all — pull the data
  programmatically, at a documented rate, with the metadata needed to audit
  the system rather than just consume it.

The forecast **value** itself (`GET /claims/:id/forecast`) is never
tier-gated — every user gets the same calibrated probability (or the same
honest "Insufficient historical data," per the acceptance gates built last
session). Only the *history* of how it moved, and *instant* notification
when it does, are paid. Charging for the number itself would create a
direct financial incentive to make free users' numbers worse, which is a
conflict of interest this product cannot afford to have even the
appearance of.

## Packaging

**Free** — current rumours; provenance and source labels; watchlist capped
at 5 players (`FREE_WATCHLIST_LIMIT`); delayed/basic alerts (a preference
field only in this implementation — no delivery mechanism exists yet, see
README); methodology visibility (`docs/forecasting-methodology.md` and the
public `GET /forecast/model-health` endpoint — deliberately **not**
tier-gated, see below).

**Supporter/Pro** — unlimited watchlist; instant-alert *preference*
(delivery mechanism is explicitly out of scope, see "Limitations");
forecast history + probability-change timeline (`GET
/claims/:id/forecast-history`, already built, now entitlement-gated);
advanced filters (minimum source tier, in this implementation — see
"Implementation scope"); CSV export of the user's own watchlist, gated by
**both** tier and a default-**off** feature flag (see "Data licensing"
below for why).

**Research/API** — documented, rate-limited API access; provenance-root and
evidence metadata; historical resolved-claim datasets; model-health and
calibration metrics; explicit license/attribution terms (see "Data
licensing"). In this implementation these are stub endpoints proving the
entitlement gate, not a shipped public API — no API-key auth system exists
yet, Research tier currently authenticates via the same cookie session as
everyone else (see "Limitations").

### Why `GET /forecast/model-health` stays free, not Research-tier

The packaging list above puts "model-health and calibration metrics" under
Research/API. This implementation deliberately does **not** gate the
existing `/forecast/model-health` endpoint. That endpoint is the concrete,
checkable evidence that the `INSUFFICIENT_DATA` gate is real and not
theater — it's cited by name in this document's own credibility argument.
Restricting it to paying users would mean only paying customers can verify
the product isn't lying to everyone else, which defeats the purpose of
having it. What Research tier actually pays for is *documented, rate-limited,
stable-contract programmatic access* to that same public information, plus
the bulk historical/evidence datasets that don't exist as public endpoints
today. This is a deliberate reinterpretation of the packaging brief, not an
oversight — flagged here explicitly rather than left implicit.

## Competitor / reputational risks

- **The "confident number" trap.** Competing services (and most sports-bet-adjacent
  products) present a single likelihood number with no calibration story and
  no uncertainty band. It reads as more useful. It's also the thing this
  product's entire architecture (see `docs/forecasting-methodology.md`) was
  built to refuse to do without real outcome data behind it. The risk isn't
  that a competitor calibrates better — it's that a competitor calibrates
  *not at all*, looks more confident, and TransferHub's honesty reads as
  weakness to a user who doesn't know the difference. Mitigation is
  positioning, not code: "Forecast, not confirmation" (already the
  `ForecastCard` disclaimer) has to be marketing language too, not just a
  UI footnote.
- **Paying for access looking like paying for accuracy.** If upgrade copy
  ever implies "Pro users get better predictions," that's a false claim and
  a regulatory/reputational risk in a space adjacent to betting markets.
  Every upgrade-prompt string in this implementation was written to
  describe *functionality* (history, speed, volume, export) and explicitly
  states forecasts don't change with tier — see `UpgradePrompt.tsx`.
- **Scraper/reseller risk on the Research tier.** Bulk historical-claim and
  evidence-metadata access is exactly the shape of data a competitor would
  want to ingest wholesale. Rate limiting and documented terms are the
  stated mitigation; this implementation stubs the entitlement gate but
  does not implement real rate limiting or license enforcement (see
  "Limitations") — that's a real gap before this tier could actually ship.
- **Source relationship risk.** Source reliability scoring
  (`Source.reliabilityScore`/`tier`) is displayed to Free users today
  (`RumourCard`'s `ReliabilityDots`). A source that dislikes its own public
  reliability score is a foreseeable reputational/legal friction point
  regardless of monetisation — noted here because Research-tier bulk export
  of that same data at scale (rather than one card at a time) changes the
  risk profile even though the underlying data was already public.

## Privacy and data-licensing considerations

**Product event instrumentation** (`ProductEvent` model,
`backend/src/analytics/`): logs five event types —
`watchlist_created`, `alert_activated`, `provenance_panel_viewed`,
`forecast_history_viewed`, `upgrade_interest_clicked`. Design decisions,
made explicitly rather than defaulted into:

- **`userId` is a real, nullable foreign key**, not a separately-generated
  pseudonym. Justification: this app already ties comparable behavioral
  data to `userId` everywhere (watchlist contents, auth session) — a
  pseudonym scheme would add complexity without adding privacy, since
  de-anonymizing back to the account would be trivial for anyone with DB
  access anyway (the FK *is* the honest representation of that fact).
  Nullable because `upgrade_interest_clicked` and (in principle)
  `provenance_panel_viewed` can happen from an anonymous session.
- **No IP address, user agent, or free-text is ever captured.** No
  third-party analytics SDK is used — everything is an internal
  `ProductEvent` row, queryable only by this application, never sent to an
  external service. This was a deliberate choice over the more common
  "just add a tracking pixel" default.
- **`provenance_panel_viewed` and `forecast_history_viewed` do NOT record
  which claim/player was viewed** — only that the panel was opened, by
  which user (or anonymously), when. Aggregate usage ("how many people used
  this feature this week") answers the product question this event exists
  for; per-claim viewing history is exactly the kind of behavioral profile
  ("this user is tracking this specific player") that isn't needed to
  answer it and is the more sensitive shape of data to hold. This is the
  one place in this implementation where under-collection was chosen
  deliberately over completeness — see `backend/src/analytics/events.ts`.
- **Retention**: a `purgeOldProductEvents()` function exists
  (`backend/src/analytics/retention.ts`) deleting rows older than 90 days.
  It is **not wired to a live cron** in this implementation — calling it is
  a manual/future-scheduling step, same "code exists, not yet live" pattern
  as `ingestEvidenceItem()` from the evidence-model work. Flagged rather
  than silently left unscheduled.

**Data licensing**: the underlying transfer/player/club data is sourced via
Sportmonks under a specific plan (`README.md` documents the "Euro Club
Tournaments" trial scope and its 2026-08-22 expiry). Two consequences for
monetisation:

1. **CSV export (Pro tier) is gated by a feature flag that defaults to
   OFF**, independent of tier — a Pro user cannot export until someone
   deliberately enables `CSV_EXPORT_WATCHLIST` in config, because whether
   re-exporting Sportmonks-derived player/club data to a user's own CSV is
   compliant with the current data license has not been reviewed. The code
   ships; the switch stays off until that review happens. See
   `backend/src/entitlements/flags.ts`.
2. **Research-tier bulk datasets are stubbed, not real**, for the same
   reason at greater severity — bulk redistribution of licensed data is a
   materially bigger licensing question than one user's own watchlist. The
   stub endpoints return application-owned data only (resolved `Claim`
   outcomes, `EvidenceItem` provenance metadata — this product's own
   analysis, not re-served provider data) and are documented as such.

## Proposed success metrics

Instrumented directly by the five `ProductEvent` types added this session
— none of these require a payment provider to start measuring:

- **Activation**: `watchlist_created` rate among new signups (does the free
  tier's core loop get used at all).
- **Engagement depth**: ratio of `forecast_history_viewed` +
  `provenance_panel_viewed` events per active user — a proxy for "are
  people actually using the explainability surface" independent of upgrade
  intent, since these are free-tier-visible views of Pro-tier-gated data
  (the panel exists and prompts upgrade; the *view attempt* is measurable
  even when the deeper data is gated).
- **Upgrade intent, not conversion**: `upgrade_interest_clicked` count and
  its distribution across which feature prompted it (`metadata.featureKey`
  on the event) — this tells product which Pro feature is actually wanted
  *before* any payment flow exists, i.e. it's usable evidence right now,
  this session, with zero billing integration.
- **Free-tier ceiling pressure**: rate at which free users hit
  `FREE_WATCHLIST_LIMIT` (a 403 from `requireEntitlement`) — a direct,
  server-logged signal of demand for the single most concrete Pro
  capability (unlimited watchlist), independent of whether they click
  upgrade.
- **What this proposal deliberately does NOT propose as a metric**:
  forecast accuracy or Brier score segmented by paid vs. free tier. There
  must never be a metric that could reward making free-tier forecasts
  worse, given they're the same number either way by design.

## Why TransferHub must not sell certainty or hide conflicting evidence

Two separate claims, both already true in the codebase this proposal builds
on top of, restated here as explicit product invariants this monetisation
work must not violate:

1. **Must not sell certainty.** `backend/src/forecasting/forecastService.ts`'s
   `getClaimForecast()` refuses to return a precise probability unless
   `ModelVersion.trainingDataSource === 'db'` — a model trained only on
   synthetic data is blocked from `PRECISE`/`INTERVAL` display
   *unconditionally*, regardless of how large its (fabricated) sample size
   is. That gate was built specifically to stop "evidence strength" from
   being repackaged as "probability." Monetisation must never create a
   reason to weaken it — e.g. a Pro-only "more confident" number, or a
   Research-tier bypass of the gate, would directly contradict the reason
   the gate exists. No such bypass is implemented or proposed.
2. **Must not hide conflicting evidence.** `ClaimDetail.officialDenial` and
   any `CONTRADICTS`-direction `EvidenceItem` are always present in the
   free-tier `GET /claims/:id` response and always rendered by
   `WhyThisForecast`/`EvidenceTimeline` — no entitlement check touches
   evidence *visibility*, only history, export, filtering depth, and alert
   speed. A user who thinks a claim is wrong must be able to find out why
   for free, immediately, or the product's core promise (grounded in
   evidence, not vibes) is fiction.

If a future change to monetisation would touch either of these two code
paths, that change needs to go back through this document's reasoning
before it ships — that's the actual purpose of writing this section down
rather than leaving it as an unstated cultural norm.

## Implementation scope (this session)

Built: `EntitlementTier` enum on `User`, two-layer entitlement resolver
(tier-required **and** independently-toggleable feature flag, returning
*which* layer denied so UI copy can distinguish "not on your plan" from
"temporarily disabled"), server-side `requireEntitlement()` middleware
applied to three real endpoints (watchlist add — 5-player free cap;
forecast-history — Pro; a new `sourceTier` advanced-filter param on
`GET /claims` — Pro) plus two representative stubs (instant-alert
*preference* endpoint — no delivery; two Research-tier bulk endpoints —
real data, no rate limiting/license enforcement yet), five `ProductEvent`
types, an `UpgradePrompt` component, and boundary tests for the free/Pro
line on watchlist and forecast-history.

**Not built, explicitly out of scope per the task**: any payment provider
integration, real alert delivery (email/push/webhook), and
license-compliance review/enforcement for CSV/bulk export (hence both stay
flag-gated off by default).

**Update, 2026-08-14**: API-key authentication for the Research tier and a
rate limiter were built in a follow-up task — see `docs/research-api.md`,
`docs/admin-operations.md`, and the "Limitations" section below, which
tracks what changed.

## Limitations

Updated 2026-08-14 — a follow-up task closed four of the five gaps
originally listed here. See `docs/public-beta-readiness-audit.md` for the
full design rationale of what changed.

- **~~The watchlist 5-player limit has a TOCTOU race~~ — closed.**
  `addToWatchlist()` is now an atomic transaction (Postgres advisory lock +
  count-check + insert, `services/watchlistService.ts`) — verified with a
  real-concurrency test (`services/watchlistService.integration.test.ts`)
  that was confirmed to fail without the fix before being considered done.
- **~~`/admin/*` routes have no authentication~~ — partially closed.** The
  entitlement-grant route now requires an authenticated `ADMIN`-role user
  (`requireAdmin`, `docs/admin-operations.md`) instead of the shared-secret
  `ADMIN_TOKEN`, which has been **retired entirely**, not kept as a
  fallback. The other nine `/admin/*` routes remain unauthenticated — still
  a real gap, restated in `docs/public-beta-readiness-audit.md` — but
  closing them is now a small follow-up (the `requireAdmin` primitive
  exists) rather than a redesign.
- **~~Research tier has no real API-key system~~ — closed.** Real API-key
  auth (`apiKeys/`), separate from the browser cookie session — see
  `docs/research-api.md`. Keys are scoped (`RESEARCH_READ`/
  `RESEARCH_EXPORT`), owner-listable (masked), and admin-revocable.
- **~~No rate limiting exists anywhere~~ — partially closed.** A small
  Redis-backed limiter now guards the admin-grant route and every
  Research API-key request (`lib/rateLimit.ts`) — see `docs/research-api.md`
  and `docs/admin-operations.md` for their (deliberately different)
  failure-mode choices. No general-purpose rate limiting exists for the
  rest of the app (`/rumours`, `/claims`, etc.).
- **New gap, introduced by closing the others**: `OperationalEvent` and
  `ApiKeyUsageEvent` (the security/ops logs added to support the above)
  have no retention policy of their own, unlike `ProductEvent` — see
  `docs/data-retention.md` for why this was deferred rather than silently
  left unstated.
