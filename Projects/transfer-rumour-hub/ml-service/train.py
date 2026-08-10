"""
Train the rumour-outcome RandomForest from ScoringSnapshot rows joined
against the final rumour status.

Gated: refuses to write a model if either class has fewer than MIN_PER_CLASS
labeled examples. That's the expected state early on — outcome detection
starts at zero negatives, so this script exits(1) with a clear message
instead of shipping a model trained on one class. Re-run any time; the
FastAPI service in app.py picks up a new model.joblib via POST /reload.

Usage:
    python train.py
    MIN_PER_CLASS=10 python train.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score
from sqlalchemy import create_engine

from features import FEATURE_NAMES, extract_features

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://user@localhost:5432/transfer_hub")
ENGINE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
MIN_PER_CLASS = int(os.environ.get("MIN_PER_CLASS", "5"))
MODEL_PATH = os.environ.get("MODEL_PATH", "model.joblib")
METADATA_PATH = os.environ.get("METADATA_PATH", "metadata.json")

QUERY = """
    SELECT
        s."sourceReliability", s."monthsToContractExpiry", s."reportedFeeMin",
        s."reportedFeeMax", s."marketValue", s."distinctSourceCount",
        s."baseProbability", r.status
    FROM scoring_snapshots s
    JOIN rumours r ON r.id = s."rumourId"
    WHERE r.status IN ('COMPLETED', 'FAILED', 'DENIED')
"""


def load_training_rows() -> pd.DataFrame:
    engine = create_engine(ENGINE_URL)
    return pd.read_sql(QUERY, engine)


def main() -> None:
    df = load_training_rows()

    n_completed = int((df["status"] == "COMPLETED").sum())
    n_negative = int((df["status"] != "COMPLETED").sum())
    print(f"Labeled snapshots: {n_completed} COMPLETED, {n_negative} FAILED/DENIED")

    if n_completed < MIN_PER_CLASS or n_negative < MIN_PER_CLASS:
        print(
            f"Not enough labeled outcomes yet (need >= {MIN_PER_CLASS} per class). "
            "Leaving any existing model untouched — /score keeps using the heuristic "
            "fallback until this has more data to train on.",
            file=sys.stderr,
        )
        sys.exit(1)

    inputs_cols = [
        "sourceReliability", "monthsToContractExpiry", "reportedFeeMin",
        "reportedFeeMax", "marketValue", "distinctSourceCount", "baseProbability",
    ]
    X = [extract_features(row.to_dict()) for _, row in df[inputs_cols].iterrows()]
    y = (df["status"] == "COMPLETED").astype(int).tolist()

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=6,
        class_weight="balanced",
        random_state=42,
    )

    cv_folds = min(5, n_completed, n_negative)
    if cv_folds >= 2:
        scores = cross_val_score(clf, X, y, cv=cv_folds, scoring="roc_auc")
        print(f"Cross-val ROC-AUC ({cv_folds}-fold): {scores.mean():.3f} +/- {scores.std():.3f}")

    clf.fit(X, y)

    joblib.dump(clf, MODEL_PATH)
    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": len(y),
        "n_completed": n_completed,
        "n_failed_or_denied": n_negative,
        "feature_names": FEATURE_NAMES,
        "feature_importances": dict(zip(FEATURE_NAMES, clf.feature_importances_.tolist())),
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Wrote {MODEL_PATH} and {METADATA_PATH}")
    print(json.dumps(metadata["feature_importances"], indent=2))


if __name__ == "__main__":
    main()
