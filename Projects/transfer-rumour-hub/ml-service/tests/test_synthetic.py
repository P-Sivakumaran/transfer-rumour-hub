import numpy as np

from app.forecasting.synthetic import FEATURE_NAMES, generate_dataset, miscalibrate, sample_features, true_probability


def test_true_probability_rises_sharply_with_official_confirmation():
    rng = np.random.default_rng(1)
    features = sample_features(rng)
    features["hasOfficialConfirmation"] = 0.0
    features["hasOfficialDenial"] = 0.0
    p_before = true_probability(features)

    features["hasOfficialConfirmation"] = 1.0
    p_after = true_probability(features)
    assert p_after > p_before + 0.3


def test_true_probability_drops_sharply_with_official_denial():
    rng = np.random.default_rng(2)
    features = sample_features(rng)
    features["hasOfficialConfirmation"] = 0.0
    features["hasOfficialDenial"] = 0.0
    p_before = true_probability(features)

    features["hasOfficialDenial"] = 1.0
    p_after = true_probability(features)
    assert p_after < p_before - 0.3


def test_true_probability_ignores_evidence_count_directly():
    rng = np.random.default_rng(3)
    features = sample_features(rng)
    features["independentRootCount"] = 2
    features["evidenceCount"] = 2
    p_low = true_probability(features)
    features["evidenceCount"] = 10  # only evidenceCount changes
    p_high = true_probability(features)
    assert p_low == p_high


def test_generate_dataset_shapes_and_bounds():
    X, y, p_true, timestamps = generate_dataset(n=500, seed=5)
    assert X.shape == (500, len(FEATURE_NAMES))
    assert y.shape == (500,)
    assert set(np.unique(y)).issubset({0, 1})
    assert np.all((p_true >= 0) & (p_true <= 1))
    assert np.all(timestamps >= 0)


def test_miscalibrate_is_monotonic_and_stays_in_bounds():
    p = np.array([0.0, 0.2, 0.5, 0.8, 1.0])
    m = miscalibrate(p, strength=0.15)
    assert np.all(np.diff(m) >= 0)
    assert np.all((m >= 0) & (m <= 1))
