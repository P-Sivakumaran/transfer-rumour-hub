"""Calibration math: isotonic regression, Brier score, log loss, calibration
curve bins, and a simple bin-based uncertainty band. No new ML framework —
sklearn.isotonic/sklearn.metrics already cover everything requirement 3/4
ask for.
"""
import math
from typing import List, Tuple

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, log_loss as sk_log_loss

# log_loss is undefined (infinite) at probability exactly 0 or 1 — clip to
# avoid a single perfectly-confident-and-wrong prediction blowing up the
# whole metric.
LOG_LOSS_CLIP_EPS = 1e-6


def fit_isotonic(raw_scores: np.ndarray, labels: np.ndarray) -> IsotonicRegression:
    """Fit on a VALIDATION split, never on train or test — see
    train_forecast.py for the three-way split this assumes."""
    calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    calibrator.fit(raw_scores, labels)
    return calibrator


def compute_brier_score(probs: np.ndarray, labels: np.ndarray) -> float:
    return float(brier_score_loss(labels, probs))


def compute_log_loss(probs: np.ndarray, labels: np.ndarray) -> float:
    clipped = np.clip(probs, LOG_LOSS_CLIP_EPS, 1 - LOG_LOSS_CLIP_EPS)
    return float(sk_log_loss(labels, clipped, labels=[0, 1]))


def calibration_curve_bins(probs: np.ndarray, labels: np.ndarray, n_bins: int = 10) -> List[dict]:
    """Equal-width bins over [0, 1]. Empty bins are omitted rather than
    reported with a misleading n=0 empirical rate."""
    bins = []
    edges = np.linspace(0, 1, n_bins + 1)
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (probs >= lo) & (probs < hi if i < n_bins - 1 else probs <= hi)
        n = int(mask.sum())
        if n == 0:
            continue
        bins.append(
            {
                "binLow": float(lo),
                "binHigh": float(hi),
                "meanPredicted": float(probs[mask].mean()),
                "empiricalRate": float(labels[mask].mean()),
                "n": n,
            }
        )
    return bins


def uncertainty_band(calibrated_prob: float, calibration_curve: List[dict]) -> Tuple[float, float]:
    """95% band from the calibration bin the prediction falls in, via a
    normal approximation to the binomial standard error of that bin's
    empirical rate (Wald interval — simple and adequate given how coarse
    these bins already are; not claiming more precision than the bin count
    supports). Falls back to a maximally wide [0, 1] band when there's no
    bin data at all (e.g. every bin was empty) rather than a fabricated
    narrow one.
    """
    if not calibration_curve:
        return (0.0, 1.0)

    containing = [b for b in calibration_curve if b["binLow"] <= calibrated_prob <= b["binHigh"]]
    bin_stat = containing[0] if containing else min(
        calibration_curve, key=lambda b: abs((b["binLow"] + b["binHigh"]) / 2 - calibrated_prob)
    )

    p = bin_stat["empiricalRate"]
    n = max(bin_stat["n"], 1)
    se = math.sqrt(p * (1 - p) / n)
    low = max(0.0, calibrated_prob - 1.96 * se)
    high = min(1.0, calibrated_prob + 1.96 * se)
    return (low, high)
