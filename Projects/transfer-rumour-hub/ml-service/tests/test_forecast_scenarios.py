"""The four scenarios requirement 6 explicitly asks for. Each test's
docstring states which one it covers.
"""
import numpy as np
from sklearn.metrics import roc_auc_score

from app.forecasting.calibration import compute_brier_score, fit_isotonic
from app.forecasting.model import load_forecast_model
from app.forecasting.synthetic import generate_dataset, miscalibrate, true_probability


def base_features(**overrides):
    features = {
        "sourceTierScore": 0.6,
        "sourceTrackRecordScore": 0.6,
        "independentRootCount": 1,
        "evidenceCount": 1,
        "evidenceDirectionScore": 0.6,
        "mostRecentEvidenceAgeHours": 24.0,
        "hasEvidence": 1.0,
        "hasOfficialConfirmation": 0.0,
        "hasOfficialDenial": 0.0,
        "detailSpecificityScore": 0.5,
        "sourceAgreementScore": 0.7,
        "monthsToContractExpiry": 12.0,
        "hasContractInfo": 1.0,
        "windowDaysRemaining": 30.0,
        "hasWindowInfo": 1.0,
        "entityMatchConfidence": 0.7,
        "dataCompletenessScore": 0.7,
    }
    features.update(overrides)
    return features


class TestScenario1CopiedArticlesDoNotInflateProbability:
    """Scenario 1: copied articles do not inflate probability.

    Ground truth (synthetic.true_probability) gives evidenceCount zero
    weight by construction — only independentRootCount matters. This test
    checks the TRAINED model (not just the DGP) actually learned that
    distinction, using the real artifact train_forecast.py produced.
    """

    def test_trained_model_barely_moves_when_only_evidence_count_increases(self):
        bundle = load_forecast_model()
        assert bundle is not None, "run `python -m app.forecasting.train_forecast` before this test"

        one_copy = base_features(independentRootCount=1, evidenceCount=1)
        five_copies = base_features(independentRootCount=1, evidenceCount=5)

        p1 = bundle.predict(one_copy)["calibratedProbability"]
        p5 = bundle.predict(five_copies)["calibratedProbability"]

        assert abs(p5 - p1) < 0.03, f"evidenceCount alone moved probability by {abs(p5 - p1):.4f}"

    def test_trained_model_responds_to_genuinely_independent_roots(self):
        """Contrast case — proves the model isn't just flat everywhere:
        varying independentRootCount itself (holding evidenceCount matched)
        SHOULD move the prediction meaningfully."""
        bundle = load_forecast_model()
        assert bundle is not None

        one_root = base_features(independentRootCount=1, evidenceCount=1)
        four_roots = base_features(independentRootCount=4, evidenceCount=4)

        p1 = bundle.predict(one_root)["calibratedProbability"]
        p4 = bundle.predict(four_roots)["calibratedProbability"]

        assert (p4 - p1) > 0.03, f"independentRootCount only moved probability by {(p4 - p1):.4f}"


class TestScenario2OfficialConfirmationDominates:
    """Scenario 2: an official confirmation dominates weaker evidence."""

    def test_official_confirmation_dominates_all_weaker_signals(self):
        bundle = load_forecast_model()
        assert bundle is not None

        weak = base_features(
            sourceTierScore=0.3, independentRootCount=1, evidenceDirectionScore=0.5,
            sourceAgreementScore=0.5, entityMatchConfidence=0.4, detailSpecificityScore=0.2,
        )
        confirmed = {**weak, "hasOfficialConfirmation": 1.0}

        p_weak = bundle.predict(weak)["calibratedProbability"]
        p_confirmed = bundle.predict(confirmed)["calibratedProbability"]

        assert p_confirmed > 0.8, f"confirmed probability was only {p_confirmed:.4f}"
        assert (p_confirmed - p_weak) > 0.5, "confirmation should dominate, not just nudge"

        # Also check it beats a large but non-official improvement to every
        # other signal at once — confirmation should still win outright.
        strong_but_unofficial = base_features(
            sourceTierScore=1.0, independentRootCount=5, evidenceDirectionScore=1.0,
            sourceAgreementScore=1.0, entityMatchConfidence=1.0, detailSpecificityScore=1.0,
        )
        p_strong_unofficial = bundle.predict(strong_but_unofficial)["calibratedProbability"]
        assert p_confirmed > p_strong_unofficial


class TestScenario3WellRankedButBadlyCalibrated:
    """Scenario 3: a prediction can be well-ranked but badly calibrated."""

    def test_miscalibrated_scores_preserve_ranking_but_break_calibration(self):
        _X, y, p_true, _ts = generate_dataset(n=2000, seed=7)
        p_miscalibrated = miscalibrate(p_true, strength=0.15)

        auc_true = roc_auc_score(y, p_true)
        auc_miscalibrated = roc_auc_score(y, p_miscalibrated)
        # Ranking is preserved — miscalibrate() is a monotone transform.
        assert abs(auc_true - auc_miscalibrated) < 0.01

        brier_true = compute_brier_score(p_true, y)
        brier_miscalibrated = compute_brier_score(p_miscalibrated, y)
        # But calibration is clearly worse — predictions cluster near 0.5
        # regardless of how extreme the true probability actually was.
        assert brier_miscalibrated > brier_true + 0.03


class TestScenario4CalibrationImprovesHoldoutBrier:
    """Scenario 4: calibrated output improves Brier score on the holdout set."""

    def test_isotonic_calibration_improves_brier_on_held_out_data(self):
        _X, y, p_true, ts = generate_dataset(n=3000, seed=11)
        p_miscalibrated = miscalibrate(p_true, strength=0.15)

        # Time-based split: oldest half fits the calibrator, newest is held
        # out — no sample used in fitting is ever scored.
        order = np.argsort(-ts)
        y, p_miscalibrated = y[order], p_miscalibrated[order]
        midpoint = len(y) // 2
        val_scores, val_labels = p_miscalibrated[:midpoint], y[:midpoint]
        test_scores, test_labels = p_miscalibrated[midpoint:], y[midpoint:]

        calibrator = fit_isotonic(val_scores, val_labels)
        calibrated_test = calibrator.predict(test_scores)

        brier_before = compute_brier_score(test_scores, test_labels)
        brier_after = compute_brier_score(calibrated_test, test_labels)

        assert brier_after < brier_before, f"calibration made Brier worse: {brier_before:.4f} -> {brier_after:.4f}"
