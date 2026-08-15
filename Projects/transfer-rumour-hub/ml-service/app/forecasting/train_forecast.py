"""Train the baseline forecasting model: regularised logistic regression +
isotonic calibration, time-based train/validation/test splits only.

Usage:
    python -m app.forecasting.train_forecast                  # synthetic (default)
    python -m app.forecasting.train_forecast --source db       # real outcomes, once there are enough

Mirrors ml-service/train.py's existing synthetic/db split and
MIN_REAL_SAMPLES gating convention — same reasoning, applied to a different
target. Writes forecast_model.joblib + forecast_model_metadata.json
(ModelVersion-shaped) into ml-service/.
"""
import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.forecasting.calibration import (
    calibration_curve_bins,
    compute_brier_score,
    compute_log_loss,
    fit_isotonic,
)
from app.forecasting.synthetic import FEATURE_NAMES, generate_dataset

MIN_REAL_SAMPLES = 200  # same threshold as ml-service/train.py's likelihood model
N_SYNTHETIC = 4000

MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "forecast_model.joblib"
METADATA_PATH = Path(__file__).resolve().parent.parent.parent / "forecast_model_metadata.json"


def time_based_split(X, y, timestamps_days_ago, train_frac=0.6, val_frac=0.2):
    """Sorted oldest → newest, then sliced. Never random — a random split
    would let a model trained on the near past evaluate against the more
    distant past, which isn't the deployment scenario (the deployment
    scenario is always "predict forward from what's known so far")."""
    order = np.argsort(-timestamps_days_ago)  # ascending time = descending days-ago
    X, y, timestamps_days_ago = X[order], y[order], timestamps_days_ago[order]

    n = len(y)
    n_train = int(n * train_frac)
    n_val = int(n * val_frac)

    train = slice(0, n_train)
    val = slice(n_train, n_train + n_val)
    test = slice(n_train + n_val, n)
    return (X[train], y[train], timestamps_days_ago[train]), (X[val], y[val], timestamps_days_ago[val]), (
        X[test],
        y[test],
        timestamps_days_ago[test],
    )


def days_ago_to_datetime(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=float(days_ago))).isoformat()


def make_db_dataset():
    import psycopg

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL not set — cannot train from db")

    # Label derivation mirrors backend/src/forecasting/labels.ts's
    # CLUB_OFFICIAL + CONFIRMS-within-horizon rule in SQL — kept in one place
    # conceptually (labels.ts is canonical; this is the same rule, not an
    # independent reimplementation of feature engineering the way the
    # likelihood model's heuristic.py is). Bounded by the forecast
    # definition's horizonDays and excludes predictions whose deadline
    # hasn't passed yet ("still pending", same as resolveLabel()'s
    # STILL_PENDING case — not a resolved training example either way).
    # Simplification vs. labels.ts: does NOT also cap by the window cutoff
    # when it's earlier than the horizon (that needs parsing
    # summerCutoffMonthDay/winterCutoffMonthDay, which SQL doesn't have a
    # clean way to do) — see docs/forecasting-methodology.md "Limitations".
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT cf."featureSnapshot", cf."predictionTimestamp",
                   EXISTS (
                     SELECT 1 FROM evidence_items ei
                     WHERE ei."claimId" = cf."claimId"
                       AND ei."sourceType" = 'CLUB_OFFICIAL'
                       AND ei."evidenceDirection" = 'CONFIRMS'
                       AND ei."publishedAt" > cf."predictionTimestamp"
                       AND ei."publishedAt" <= cf."predictionTimestamp" + (fd."horizonDays" || ' days')::interval
                   ) AS confirmed
            FROM claim_forecasts cf
            JOIN forecast_definitions fd ON fd.id = cf."forecastDefinitionId"
            WHERE cf."predictionTimestamp" + (fd."horizonDays" || ' days')::interval <= now()
            """
        )
        rows = cur.fetchall()

    if len(rows) < MIN_REAL_SAMPLES:
        raise SystemExit(
            f"Only {len(rows)} claim_forecasts rows in db — need {MIN_REAL_SAMPLES}+ to "
            "train a real model. Run with --source synthetic (default) until then."
        )

    X, y, timestamps = [], [], []
    now = datetime.now(timezone.utc)
    for feature_snapshot, prediction_timestamp, confirmed in rows:
        X.append([feature_snapshot.get(name, 0.0) for name in FEATURE_NAMES])
        y.append(1 if confirmed else 0)
        timestamps.append((now - prediction_timestamp).total_seconds() / 86400)
    return np.array(X), np.array(y), np.array(timestamps)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["synthetic", "db"], default="synthetic")
    parser.add_argument("--forecast-definition-version", type=int, default=1)
    args = parser.parse_args()

    if args.source == "synthetic":
        print(f"Generating {N_SYNTHETIC} synthetic samples with a known ground-truth DGP...")
        X, y, _true_probs, timestamps = generate_dataset(N_SYNTHETIC)
    else:
        print("Loading resolved claim_forecasts from Postgres...")
        X, y, timestamps = make_db_dataset()

    (X_train, y_train, ts_train), (X_val, y_val, ts_val), (X_test, y_test, ts_test) = time_based_split(
        X, y, timestamps
    )

    # Features span wildly different scales (0/1 flags next to
    # windowDaysRemaining up to ~90) — StandardScaler first, otherwise
    # lbfgs doesn't reliably converge and the fitted coefficients end up
    # dominated by whichever feature happens to have the largest raw range,
    # not the largest actual effect.
    model = make_pipeline(StandardScaler(), LogisticRegression(penalty="l2", C=1.0, max_iter=1000))
    model.fit(X_train, y_train)

    raw_val_scores = model.predict_proba(X_val)[:, 1]
    calibrator = fit_isotonic(raw_val_scores, y_val)

    raw_test_scores = model.predict_proba(X_test)[:, 1]
    calibrated_test_probs = calibrator.predict(raw_test_scores)

    brier = compute_brier_score(calibrated_test_probs, y_test)
    brier_uncalibrated = compute_brier_score(raw_test_scores, y_test)
    logloss = compute_log_loss(calibrated_test_probs, y_test)
    curve = calibration_curve_bins(calibrated_test_probs, y_test)

    print(f"Held-out test Brier score — calibrated: {brier:.4f}, uncalibrated: {brier_uncalibrated:.4f}")
    print(f"Held-out test log loss (calibrated): {logloss:.4f}")
    print(f"train={len(y_train)} val={len(y_val)} test={len(y_test)}")

    import joblib

    joblib.dump({"model": model, "calibrator": calibrator, "feature_names": FEATURE_NAMES}, MODEL_PATH)

    version = f"forecast-v{args.forecast_definition_version}-{args.source}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"
    metadata = {
        "version": version,
        "forecastDefinitionVersion": args.forecast_definition_version,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "trainingDataSource": args.source,
        "nTrainSamples": len(y_train),
        "nTestSamples": len(y_test),
        "trainStart": days_ago_to_datetime(float(ts_train.max())) if len(ts_train) else None,
        "trainEnd": days_ago_to_datetime(float(ts_train.min())) if len(ts_train) else None,
        "testStart": days_ago_to_datetime(float(ts_test.max())) if len(ts_test) else None,
        "testEnd": days_ago_to_datetime(float(ts_test.min())) if len(ts_test) else None,
        "brierScore": brier,
        "brierScoreUncalibrated": brier_uncalibrated,
        "logLoss": logloss,
        "calibrationCurve": curve,
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2))
    print(f"Saved model to {MODEL_PATH}, metadata to {METADATA_PATH} (version={version})")


if __name__ == "__main__":
    main()
