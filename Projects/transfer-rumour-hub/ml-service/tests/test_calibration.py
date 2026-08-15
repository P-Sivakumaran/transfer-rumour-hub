import numpy as np

from app.forecasting.calibration import (
    calibration_curve_bins,
    compute_brier_score,
    compute_log_loss,
    fit_isotonic,
    uncertainty_band,
)


def test_brier_score_perfect_predictions_is_zero():
    probs = np.array([1.0, 0.0, 1.0, 0.0])
    labels = np.array([1, 0, 1, 0])
    assert compute_brier_score(probs, labels) == 0.0


def test_brier_score_worst_case_is_one():
    probs = np.array([0.0, 1.0])
    labels = np.array([1, 0])
    assert compute_brier_score(probs, labels) == 1.0


def test_log_loss_handles_extreme_probabilities_without_raising():
    probs = np.array([1.0, 0.0, 0.5])
    labels = np.array([1, 0, 1])
    result = compute_log_loss(probs, labels)
    assert np.isfinite(result)


def test_calibration_curve_bins_report_empirical_rate_per_bin():
    probs = np.array([0.05, 0.06, 0.55, 0.95])
    labels = np.array([0, 1, 1, 1])
    bins = calibration_curve_bins(probs, labels, n_bins=10)
    low_bin = next(b for b in bins if b["binLow"] <= 0.05 < b["binHigh"])
    assert low_bin["n"] == 2
    assert low_bin["empiricalRate"] == 0.5


def test_calibration_curve_bins_omits_empty_bins():
    probs = np.array([0.05, 0.06])
    labels = np.array([0, 1])
    bins = calibration_curve_bins(probs, labels, n_bins=10)
    assert len(bins) == 1


def test_fit_isotonic_is_monotonic_nondecreasing():
    rng = np.random.default_rng(0)
    raw = rng.uniform(0, 1, 200)
    labels = (raw + rng.normal(0, 0.1, 200) > 0.5).astype(int)
    calibrator = fit_isotonic(raw, labels)
    xs = np.linspace(0, 1, 20)
    ys = calibrator.predict(xs)
    assert np.all(np.diff(ys) >= -1e-9)


def test_uncertainty_band_widens_with_smaller_bin_sample_size():
    curve_wide = [{"binLow": 0.4, "binHigh": 0.5, "meanPredicted": 0.45, "empiricalRate": 0.5, "n": 5}]
    curve_narrow = [{"binLow": 0.4, "binHigh": 0.5, "meanPredicted": 0.45, "empiricalRate": 0.5, "n": 5000}]
    low_wide, high_wide = uncertainty_band(0.45, curve_wide)
    low_narrow, high_narrow = uncertainty_band(0.45, curve_narrow)
    assert (high_wide - low_wide) > (high_narrow - low_narrow)


def test_uncertainty_band_falls_back_to_full_range_with_no_curve():
    assert uncertainty_band(0.5, []) == (0.0, 1.0)
