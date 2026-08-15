"""Synthetic forecast dataset generator.

The dev DB has ~0 resolved Claim outcomes (see README/docs/forecasting-methodology.md)
— every trained artifact in this pipeline is necessarily synthetic-only
until real outcomes accumulate, same situation ml-service/train.py already
documents for the (separate) likelihood model. This generator exists to
exercise the pipeline end-to-end with a KNOWN ground-truth data-generating
process, which is what makes the requirement-6 test scenarios possible at
all: with real data we'd never know the "true" probability to compare
against, only the label.

Feature names/order here MUST match backend/src/forecasting/featureSnapshot.ts's
output exactly — see FEATURE_NAMES.
"""
import numpy as np

FEATURE_NAMES = [
    "sourceTierScore",
    "sourceTrackRecordScore",
    "independentRootCount",
    "evidenceCount",
    "evidenceDirectionScore",
    "mostRecentEvidenceAgeHours",
    "hasEvidence",
    "hasOfficialConfirmation",
    "hasOfficialDenial",
    "detailSpecificityScore",
    "sourceAgreementScore",
    "monthsToContractExpiry",
    "hasContractInfo",
    "windowDaysRemaining",
    "hasWindowInfo",
    "entityMatchConfidence",
    "dataCompletenessScore",
]


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def true_probability(features: dict) -> float:
    """The ground-truth P(official confirmation within horizon), as a known
    function of features. `evidenceCount` (raw signal volume, including
    copies/syndications) is DELIBERATELY given zero weight — only
    `independentRootCount` (distinct provenance roots) should move the
    probability. This is what makes the "copied articles don't inflate
    probability" test meaningful: it's true by construction of this
    function, and the trained model is checked against it.
    """
    z = -3.0
    z += 6.0 * features["hasOfficialConfirmation"]
    z -= 6.0 * features["hasOfficialDenial"]
    z += 1.5 * features["sourceTierScore"]
    z += 0.8 * np.log1p(features["independentRootCount"])
    z += 2.4 * (features["evidenceDirectionScore"] - 0.5)
    z += 1.6 * (features["sourceAgreementScore"] - 0.5)
    z += 1.0 * features["entityMatchConfidence"]
    z += 0.5 * features["detailSpecificityScore"]
    z += 0.5 * features["dataCompletenessScore"]
    if features["hasContractInfo"]:
        z -= 0.02 * features["monthsToContractExpiry"]
    if features["hasWindowInfo"]:
        z -= 0.01 * max(features["windowDaysRemaining"], 0)
    z -= 0.0005 * features["mostRecentEvidenceAgeHours"]
    return float(_sigmoid(np.array([z]))[0])


def sample_features(rng: np.random.Generator) -> dict:
    independent_root_count = int(rng.integers(1, 6))
    # Copies/syndications inflate evidenceCount well beyond independentRootCount
    # without adding independent corroboration — sampled independently so the
    # dataset actually contains cases where they diverge.
    evidence_count = independent_root_count + int(rng.integers(0, 6))
    has_contract_info = rng.random() > 0.2
    has_window_info = rng.random() > 0.15
    return {
        "sourceTierScore": float(rng.uniform(0.2, 1.0)),
        "sourceTrackRecordScore": float(rng.uniform(0.2, 1.0)),
        "independentRootCount": independent_root_count,
        "evidenceCount": evidence_count,
        "evidenceDirectionScore": float(rng.uniform(0, 1)),
        "mostRecentEvidenceAgeHours": float(rng.uniform(0, 720)),
        "hasEvidence": 1.0,
        "hasOfficialConfirmation": 1.0 if rng.random() < 0.08 else 0.0,
        "hasOfficialDenial": 1.0 if rng.random() < 0.05 else 0.0,
        "detailSpecificityScore": float(rng.uniform(0, 1)),
        "sourceAgreementScore": float(rng.uniform(0.3, 1.0)),
        "monthsToContractExpiry": float(rng.uniform(0, 36)) if has_contract_info else -1.0,
        "hasContractInfo": 1.0 if has_contract_info else 0.0,
        "windowDaysRemaining": float(rng.uniform(0, 90)) if has_window_info else -1.0,
        "hasWindowInfo": 1.0 if has_window_info else 0.0,
        "entityMatchConfidence": float(rng.uniform(0.3, 1.0)),
        "dataCompletenessScore": float(rng.uniform(0.2, 1.0)),
    }


def generate_dataset(n: int, seed: int = 42, start_days_ago: int = 400):
    """Returns (X, y, true_probs, timestamps) — timestamps are synthetic but
    monotonically distributed over `start_days_ago` days back from "now", so
    train_forecast.py's time-based split has something real to sort by.
    """
    rng = np.random.default_rng(seed)
    rows, labels, true_probs = [], [], []
    day_offsets = np.sort(rng.uniform(0, start_days_ago, size=n))[::-1]  # oldest first

    for i in range(n):
        features = sample_features(rng)
        p = true_probability(features)
        label = 1 if rng.random() < p else 0
        rows.append([features[name] for name in FEATURE_NAMES])
        labels.append(label)
        true_probs.append(p)

    X = np.array(rows)
    y = np.array(labels)
    p_true = np.array(true_probs)
    timestamps = day_offsets  # days-ago, ascending time = descending days-ago
    return X, y, p_true, timestamps


def miscalibrate(true_probs: np.ndarray, strength: float = 0.15) -> np.ndarray:
    """A monotone-but-miscalibrated transform: squashes probabilities toward
    0.5 by `strength`. Monotone in true_probs, so rank order (AUC) is
    preserved — but predicted values understate how extreme the true
    probability actually is, which is exactly what produces a bad Brier
    score despite good ranking. This is the generator requirement 6's
    "well-ranked but badly calibrated" test needs.
    """
    return 0.5 + (true_probs - 0.5) * strength
