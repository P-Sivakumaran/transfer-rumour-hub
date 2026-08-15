# Forecasting methodology

Covers the calibrated forecasting pipeline added 2026-08-14:
`backend/src/forecasting/` (target definition, feature snapshots, labels,
acceptance gates) and `ml-service/app/forecasting/` (baseline model,
calibration, synthetic training data).

## The critical distinction this whole pipeline exists to enforce

**Evidence strength is not a probability.** A claim with five corroborating
articles from reputable outlets *feels* more credible than one with a single
weak source — but "feels credible" and "70% likely to be confirmed within 30
days" are different kinds of claims. The first is a qualitative judgment
about evidence quality; the second is a falsifiable, empirically-checkable
statement about frequency. Conflating them is the single most common error
in systems like this one: a heuristic evidence score gets rendered with a
`%` sign next to it, and users read it as a probability because it looks
like one.

This pipeline keeps the two separate by construction:

- **Evidence strength** is what `backend/src/evidence/` (the provenance
  model — Claim, EvidenceItem, independent-source counting) and the
  existing `likelihoodEngine.ts` heuristic produce. Neither is calibrated
  against outcomes. Neither should ever be labeled "probability" in the UI.
- **Calibrated probability** is what this pipeline produces, and *only* when
  a model has been fit and evaluated against real resolved outcomes
  (`ModelVersion.trainingDataSource === 'db'`) with enough held-out samples
  to trust the evaluation. Every other case — no model, a synthetic-only
  model, a service outage, a too-wide uncertainty band — displays
  `INSUFFICIENT_DATA` or `INTERVAL`, never a fabricated point estimate.

As of this writing, **no calibrated probability has ever been displayed**,
because the dev DB has ~0 resolved `Claim` outcomes. That's not a bug — it's
the gate working. See "Current status" below.

## 1. Target definition

**"Will this canonical transfer claim receive an official club confirmation
within N days, or before the relevant transfer-window cutoff — whichever
comes first?"**

Persisted as `ForecastDefinition` (`backend/prisma/schema.prisma`):

- `horizonDays` — N, configurable per definition.
- `summerCutoffMonthDay` / `winterCutoffMonthDay` — MM-DD approximations of
  when each transfer window closes, also configurable. **No cutoff-date
  concept existed anywhere in this codebase before this pipeline** — the
  existing `guessWindow()` helpers (`rss.ts`, `sportmonks.ts`,
  `apifootball.ts`) only ever infer SUMMER/WINTER from a month number, never
  a closing date. These MM-DD values are a deliberate simplification (see
  "Limitations"), not a source of truth for real competition calendars.
- `version` — immutable once created. Redefining N or the cutoffs creates a
  new `ForecastDefinition` row rather than mutating an existing one, so
  every `ClaimForecast`/`ModelVersion` stays attributable to the exact
  target it was produced under.

**Label resolution** (`backend/src/forecasting/labels.ts`, `resolveLabel()`):
positive (1) when an `EvidenceItem` with `sourceType = CLUB_OFFICIAL` and
`evidenceDirection = CONFIRMS` exists with `publishedAt` strictly after the
prediction timestamp (`asOf`) and on or before the effective deadline
(`min(asOf + horizonDays, windowCutoff)`). Negative (0) when that deadline
has passed (relative to wall-clock "now") with no such confirmation. `null`
("still pending") when the deadline hasn't arrived yet — these claims are
excluded from training, not treated as negatives, because "no confirmation
yet" and "confirmation will never come" are not the same thing.

A denial (`CLUB_OFFICIAL` + `DENIES`) does not produce a positive label on
its own — only an explicit confirmation does. A claim that's denied and
never confirmed resolves to label 0 once its deadline passes, the same as a
claim that simply goes quiet.

## 2. Feature snapshot and temporal leakage prevention

`backend/src/forecasting/featureSnapshot.ts`, `buildFeatureSnapshot(db, claimId, asOf, cutoffConfig)`.

Every feature must be reconstructible from information that existed at
`asOf`. Three guards enforce this, in decreasing order of how likely a naive
implementation is to get them right:

1. **`claim.firstSeenAt > asOf` → returns `null`.** The claim didn't exist
   yet; there's nothing to snapshot. Easy to get right, easy to test.
2. **Every `EvidenceItem` is filtered to `publishedAt <= asOf` before any
   feature touches it.** This is the filter that matters most in practice —
   `featureSnapshot.test.ts`'s "temporal leakage prevention" block
   constructs a claim with one evidence item before `asOf` and one official
   confirmation after it, and asserts the confirmation is invisible to
   every derived feature (`hasOfficialConfirmation`, `evidenceCount`,
   `independentRootCount`). This is the case a code reviewer would actually
   catch; it's tested anyway because "obviously correct" filters are
   exactly the ones that silently break under refactoring.
3. **`Source.reliabilityScore`/`hitCount`/`missCount` are never selected at
   all**, not filtered — excluded outright. Those fields are mutated *in
   place* by `outcomeDetector.ts`'s `applyOutcome()`, with no history table.
   A snapshot built "as of" a past date would silently read today's value,
   already updated by outcomes resolved on *other* claims after `asOf` — and
   the `publishedAt <= asOf` filter above does nothing to catch this,
   because it filters evidence rows, not source state. This is the
   leakage class that's easy to miss because nothing about it looks like a
   timestamp bug. `featureSnapshot.test.ts` proves it directly: the same
   snapshot is computed twice with a source's `reliabilityScore`/
   `hitCount`/`missCount` mutated between calls, and the output is asserted
   identical.

`Source.tier` stands in as the "source track record" feature instead. It's
editorial (set by a human reviewer via `manualReviewStatus`/
`profileVersion`), not outcome-derived — but it isn't perfectly leakage-free
either: a reviewer could still raise or lower a source's tier *because of*
how its track record played out, which is a slower, indirect version of the
same problem. This is flagged, not solved — see "Limitations".

### Features (17 total — see `FEATURE_NAMES` in `ml-service/app/forecasting/synthetic.py`, kept in sync with `featureSnapshot.ts`'s output keys by convention, not by codegen)

| Feature | Source |
|---|---|
| `sourceTierScore`, `sourceTrackRecordScore` | `Source.tier`, averaged across contributing sources as of `asOf` |
| `independentRootCount` | distinct `provenanceRootId` among evidence as of `asOf` (see `evidence/evidenceService.ts`) |
| `evidenceCount` | raw count — deliberately NOT what corroboration strength should be judged on, see below |
| `evidenceDirectionScore`, `sourceAgreementScore` | fraction supporting vs. contradicting, and per-source agreement, as of `asOf` |
| `mostRecentEvidenceAgeHours`, `hasEvidence` | recency |
| `hasOfficialConfirmation`, `hasOfficialDenial` | `CLUB_OFFICIAL` + `CONFIRMS`/`DENIES` present as of `asOf` |
| `detailSpecificityScore` | fraction of `statedFee`/`statedContractLengthMonths`/`transferType` present |
| `monthsToContractExpiry`, `hasContractInfo` | `Player.contractEnd` relative to `asOf`; `-1` sentinel when unknown |
| `windowDaysRemaining`, `hasWindowInfo` | resolved window cutoff relative to `asOf`; `-1` sentinel when unknown |
| `entityMatchConfidence` | average `EvidenceItem.extractionConfidence` as of `asOf` |
| `dataCompletenessScore` | fraction of the above optional signals actually present |

**`evidenceCount` vs. `independentRootCount`** is the load-bearing
distinction for "evidence direction and recency" and "source
agreement/disagreement" done right: five syndicated write-ups of one
Fabrizio Romano scoop push `evidenceCount` to 5 but `independentRootCount`
stays 1 (see `docs/forecasting-audit.md` and the evidence model's own
requirement-7 test — "five articles derived from one original report count
as one independent source"). The synthetic training data's ground-truth
function (`synthetic.true_probability()`) gives `evidenceCount` zero weight
by construction, specifically so this property is checkable end-to-end: see
requirement 6's "copied articles do not inflate probability" test.

## 3. Baseline model and calibration

`ml-service/app/forecasting/train_forecast.py`.

- **Model**: `LogisticRegression(penalty='l2', C=1.0)` behind a
  `StandardScaler` (features span wildly different scales — 0/1 flags next
  to `windowDaysRemaining` up to ~90 — without scaling, `lbfgs` doesn't
  reliably converge). Interpretable by construction; no new ML framework —
  `scikit-learn` was already a dependency for the existing likelihood
  model's `RandomForestRegressor`.
- **Calibration**: `sklearn.isotonic.IsotonicRegression`, fit on a
  **validation** split, never on train or test.
- **Splits are strictly time-based** (`time_based_split()`): sorted oldest
  → newest, then sliced 60% train / 20% validation / 20% test. Never
  random — a random split would let a model evaluate against data from
  *before* some of its training data, which isn't the deployment scenario
  (deployment always predicts forward from what's known so far).
- **Reproducibility/versioning**: every training run writes
  `forecast_model.joblib` (model + calibrator + feature name list) and
  `forecast_model_metadata.json` (version string with a timestamp,
  `trainingDataSource`, sample counts, split date boundaries, evaluation
  metrics, calibration curve). `backend/prisma/seedForecastModel.ts` reads
  that JSON and registers it as a `ModelVersion` row, demoting whatever was
  previously `isCurrent` for that `ForecastDefinition`.

### Why Python doesn't re-derive features

The existing likelihood model (`likelihoodEngine.ts` / `ml-service/app/heuristic.py`)
hand-ports its feature/scoring logic between TypeScript and Python, and its
own docstring says to "keep in lockstep" — a manual process with no test
enforcing it (flagged in `docs/forecasting-audit.md` as a standing drift
risk). This pipeline avoids that class of bug entirely: `featureSnapshot.ts`
is the *only* place feature engineering happens. Python receives a flat
`Dict[str, float]` over the wire and only does model math. There is nothing
to keep "in lockstep" because there's only one implementation.

## 4. What's persisted per prediction

`ClaimForecast` (append-only, one row per `(claim, asOf)` prediction):
`featureSnapshot` (the exact vector used) + `featureSnapshotHash`
(SHA-256, for auditability without re-deriving from possibly-since-changed
evidence rows), `rawScore`, `calibratedProbability`, `uncertaintyLow/High`,
`displayMode`, `insufficientDataReason`, `modelVersionId`,
`predictionTimestamp`.

`ModelVersion` (one row per trained artifact, never overwritten in place):
`trainingDataSource`, `nTrainSamples`/`nTestSamples`, `trainStart/End`,
`testStart/End`, `brierScore`, `logLoss`, `calibrationCurve` (bin stats —
`binLow`, `binHigh`, `meanPredicted`, `empiricalRate`, `n`), `isCurrent`.

## 5. Uncertainty

`uncertainty_band()` (`ml-service/app/forecasting/calibration.py`) locates
the calibration bin the prediction falls into and returns a 95% Wald
interval around that bin's *empirical* rate, using a normal approximation
to binomial standard error (`p(1-p)/n`). This is deliberately simple —
these bins are already coarse (10 equal-width buckets over a small holdout
set), and a fancier interval (bootstrap, Bayesian credible interval) would
imply a precision the underlying sample size doesn't support. When a bin
has very few samples, the band widens accordingly (tested in
`test_calibration.py`); when there's no calibration curve at all, the band
is the maximally honest `[0, 1]`, not a fabricated narrow one.

`forecastService.ts` uses the band's width as a second gate, independent of
sample size: an interval wider than 0.4 forces `displayMode = INTERVAL`
(show the range, not a point estimate) even when the model itself is
otherwise eligible for `PRECISE` display.

## 6. Evaluation

Requirement 6's four scenarios, all in `ml-service/tests/test_forecast_scenarios.py`:

1. **Copied articles don't inflate probability** — the *trained* model
   (not just the synthetic generator) is checked directly: holding
   `independentRootCount` fixed and varying `evidenceCount` from 1 to 5
   moves the calibrated probability by < 0.03; varying
   `independentRootCount` itself (the contrast case, proving the model
   isn't just flat everywhere) moves it by > 0.03.
2. **Official confirmation dominates weaker evidence** — a weak-evidence
   feature vector's probability, with `hasOfficialConfirmation` flipped to
   1, both exceeds 0.8 and beats a feature vector where every *other*
   signal is maxed out but confirmation is absent.
3. **Well-ranked but badly calibrated** — `synthetic.miscalibrate()`
   applies a monotone squash-toward-0.5 to the true probabilities. AUC
   against labels is preserved (ranking intact) while Brier score against
   the same labels is markedly worse (calibration broken) — demonstrating
   these are genuinely different properties, not two names for the same
   thing.
4. **Calibrated output improves Brier score on holdout** — the same
   miscalibrated scores, split by time into a validation half (fits the
   isotonic calibrator) and a test half (scored only), show a strictly
   lower Brier score after calibration than before — measured out-of-sample,
   not on the data the calibrator was fit on.

Scenario 4 uses the *deliberately miscalibrated* synthetic generator, not
the end-to-end `train_forecast.py` run — see "Limitations" for why the
baseline `LogisticRegression`'s own native probabilities are already close
to calibrated on this clean synthetic DGP, which is a separate (and
expected) finding, not a contradiction of scenario 4.

## 7. Acceptance gates

`backend/src/forecasting/forecastService.ts`, `getClaimForecast()` — the
single call site every displayed probability goes through:

1. No `ModelVersion` exists → `INSUFFICIENT_DATA`.
2. **`ModelVersion.trainingDataSource !== 'db'` → `INSUFFICIENT_DATA`,
   unconditionally, regardless of sample size.** This is the gate that
   actually enforces the critical product rule, and it was nearly missing:
   an earlier version of this pipeline gated only on sample count, which a
   synthetic model can trivially satisfy (`train_forecast.py` can generate
   as many synthetic rows as asked). Verified live: with a trained,
   correctly-serving synthetic model and a running ml-service,
   `GET /claims/1/forecast` still returns `INSUFFICIENT_DATA` with reason
   "trained on synthetic data only."
3. `nTestSamples < minSampleSizeForPrecise` (default 200, matching the
   existing likelihood model's `MIN_REAL_SAMPLES` convention) →
   `INSUFFICIENT_DATA`.
4. ml-service unreachable or errors → `INSUFFICIENT_DATA`. **No fallback to
   a heuristic number** — `mlForecastClient.ts`'s docstring spells out why
   this deliberately diverges from `likelihoodEngine.ts`'s
   fallback-to-heuristic pattern: that fallback is correct for a
   0–100 heuristic score falling back to another heuristic; it would be
   wrong here, where the fallback target is a number rendered as a
   probability.
5. Uncertainty band wider than 0.4 → `INTERVAL` (range only) instead of
   `PRECISE` (point estimate).

`GET /forecast/model-health` (`forecastController.ts`) exposes every
`ForecastDefinition`'s current model — training data source, sample counts,
Brier/log-loss, full calibration curve — plus a best-effort live ping to
ml-service's own `/forecast/health`. The stored evaluation data is still
returned even when ml-service is unreachable, since "is the model healthy"
shouldn't itself go blank because the scoring service happens to be down.

## Current status

**No calibrated probability has ever been displayed by this system.** The
dev DB has ~0 resolved `Claim` outcomes (the `Claim`/`EvidenceItem`
provenance model itself is new as of 2026-08-14 — see
`docs/forecasting-audit.md`). A baseline model has been trained
(`train_forecast.py --source synthetic`, the default) and registered
(`seedForecastModel.ts`) purely to prove the pipeline works end-to-end —
feature snapshot → ml-service → calibration → persistence → gate — not
because it's fit to ship. Gate #2 above ensures it can't be shown regardless.

The path to an actual calibrated probability: `POST /claims/:id/forecast`
needs to be called repeatedly over time as real claims resolve (this
persists `ClaimForecast` rows with real feature snapshots), and
`train_forecast.py --source db` needs 200+ of those rows with resolved
labels (enforced by `MIN_REAL_SAMPLES`, same threshold as the existing
likelihood model). Nothing about *when* that happens is under this
pipeline's control — it's gated on real usage accumulating real outcomes,
not on more code.

## Limitations

- **Window cutoff dates are a configurable approximation, not a real
  calendar.** `summerCutoffMonthDay`/`winterCutoffMonthDay` are single
  MM-DD values shared across every competition; real transfer windows vary
  by league and season (the existing Sportmonks integration is itself
  scoped to only 4 UEFA competitions — see README). Configurable via
  `ForecastDefinition` rather than hardcoded, but still one global
  approximation, not per-league data.
- **`Source.tier` is not perfectly leakage-free.** It's editorial rather
  than outcome-derived, which is why it's used in place of
  `reliabilityScore`/`hitCount`/`missCount` — but a human reviewer could
  still adjust a source's tier partly *because of* its track record,
  which is a slower, indirect version of the same leakage class. Not
  solved here; flagged so it isn't mistaken for solved.
- **`--source db` training doesn't cap by the window cutoff, only by
  `horizonDays`.** `labels.ts` (the TypeScript, canonical implementation)
  correctly uses `min(horizonEnd, windowCutoff)` as the deadline;
  `train_forecast.py`'s SQL approximation only bounds by `horizonDays`
  because parsing `summerCutoffMonthDay`/`winterCutoffMonthDay` cleanly in
  SQL wasn't worth the complexity for a code path that's unreachable until
  200+ real resolved predictions exist. Should be revisited before that
  threshold is actually hit.
- **Isotonic calibration barely moved the Brier score on the baseline
  end-to-end training run** (0.1736 calibrated vs. 0.1718 uncalibrated on
  the held-out test split, i.e. calibration was roughly neutral, not a
  clear improvement) — because `LogisticRegression` trained on a clean
  synthetic DGP already produces near-calibrated probabilities natively;
  there isn't much miscalibration left for isotonic regression to fix, and
  fitting it on a modest validation split (800 rows) can introduce as much
  noise as signal. This is expected and doesn't contradict requirement 6's
  Brier-improvement test, which uses a *deliberately* miscalibrated score
  (`synthetic.miscalibrate()`) specifically to isolate and demonstrate the
  calibration step's effect in a setting where there's real miscalibration
  to correct. Real-world raw model scores (once trained on real outcomes)
  may or may not be as naturally well-calibrated as this synthetic
  baseline — that's an empirical question the current gates prevent this
  system from answering prematurely.
- **`EvidenceItem.sourceType`/`Claim.window` etc. are all snapshotted at
  feature-build time from current rows**, except evidence itself (which is
  properly time-filtered). A `Player`'s `contractEnd` being corrected
  retroactively, for instance, would affect a feature snapshot built for a
  past `asOf` the same way the `Source.tier` situation does. Only the two
  leakage classes covered by the explicit tests in "Temporal leakage
  prevention" above are guaranteed closed.
- **No frontend surface for any of this yet** — `docs/forecasting-audit.md`'s
  §6e (explainable rumour detail UI, for the existing heuristic score) and
  this pipeline's own display gates are both backend/API-only as of this
  writing.
