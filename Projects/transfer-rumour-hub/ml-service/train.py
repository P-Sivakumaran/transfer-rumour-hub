"""Train the likelihood-scoring RandomForest and write model.joblib.

Two data sources, picked with --source:

  synthetic (default) — random ScoringInputs sampled from realistic ranges,
    labeled with the existing TS heuristic (ported in app/heuristic.py) plus
    noise. This is a DISTILLATION model, not an outcome-trained one: as of
    2026-08-12 the dev DB has 6 rumours total (5 PENDING, 1 COMPLETED) and 8
    rumour_history rows — nowhere near enough resolved outcomes to fit a real
    classifier. Its purpose is to stand up the FastAPI service and the
    backend swap path end-to-end; it will track the heuristic closely by
    construction, not outperform it.

  db — trains on actual resolved rumours (status IN COMPLETED/FAILED/DENIED)
    read from Postgres. Refuses to run below MIN_REAL_SAMPLES because a
    forest fit on a few dozen rows is worse than the heuristic it replaces.
    Switch to this once real outcomes accumulate.

Usage:
    python train.py                  # synthetic distillation (works today)
    python train.py --source db      # real outcomes (once there are enough)
"""
import argparse
import os

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

from app.heuristic import heuristic_score
from app.model import FEATURE_NAMES, save_model, to_feature_vector
from app.schemas import ScoringInputs

MIN_REAL_SAMPLES = 200
N_SYNTHETIC = 6000


def make_synthetic_dataset(n: int, seed: int = 42):
    rng = np.random.default_rng(seed)
    X, y = [], []
    for _ in range(n):
        inputs = ScoringInputs(
            sourceReliability=float(rng.uniform(0, 1)),
            monthsToContractExpiry=(
                None if rng.random() < 0.15 else float(rng.uniform(0, 36))
            ),
            reportedFeeMin=(None if rng.random() < 0.3 else float(rng.uniform(0, 120))),
            reportedFeeMax=(None if rng.random() < 0.3 else float(rng.uniform(0, 150))),
            marketValue=(None if rng.random() < 0.2 else float(rng.uniform(1, 130))),
            clubNeedScore=float(rng.uniform(0, 1)),
            distinctSourceCount=int(rng.integers(1, 8)),
            baseProbability=(None if rng.random() < 0.4 else float(rng.uniform(0, 1))),
        )
        label = heuristic_score(inputs).score + float(rng.normal(0, 4))
        X.append(to_feature_vector(inputs))
        y.append(np.clip(label, 0, 100))
    return np.array(X), np.array(y)


def make_db_dataset():
    import psycopg

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL not set — cannot train from db")

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              s."reliabilityScore",
              r."reportedFeeMin", r."reportedFeeMax",
              p."marketValue",
              r."distinctSourceCount",
              r."baseProbability",
              p."contractEnd",
              r."createdAt",
              r.status
            FROM rumours r
            JOIN sources s ON s.id = r."sourceId"
            JOIN players p ON p.id = r."playerId"
            WHERE r.status IN ('COMPLETED', 'FAILED', 'DENIED')
            """
        )
        rows = cur.fetchall()

    if len(rows) < MIN_REAL_SAMPLES:
        raise SystemExit(
            f"Only {len(rows)} resolved rumours in db — need {MIN_REAL_SAMPLES}+ to "
            "train a real model. Run with --source synthetic (default) until then."
        )

    X, y = [], []
    for reliability, fee_min, fee_max, market_value, source_count, base_prob, contract_end, created_at, status in rows:
        months_to_expiry = (
            (contract_end - created_at).days / 30.44 if contract_end else None
        )
        inputs = ScoringInputs(
            sourceReliability=reliability,
            monthsToContractExpiry=months_to_expiry,
            reportedFeeMin=fee_min,
            reportedFeeMax=fee_max,
            marketValue=market_value,
            clubNeedScore=0.6,  # same stub the TS engine uses today
            distinctSourceCount=source_count,
            baseProbability=base_prob,
        )
        X.append(to_feature_vector(inputs))
        y.append(100.0 if status == "COMPLETED" else 0.0)
    return np.array(X), np.array(y)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["synthetic", "db"], default="synthetic")
    args = parser.parse_args()

    if args.source == "synthetic":
        print(f"Generating {N_SYNTHETIC} synthetic samples labeled by the heuristic engine...")
        X, y = make_synthetic_dataset(N_SYNTHETIC)
    else:
        print("Loading resolved rumours from Postgres...")
        X, y = make_db_dataset()

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = RandomForestRegressor(n_estimators=200, max_depth=8, random_state=42)
    model.fit(X_train, y_train)

    train_r2 = model.score(X_train, y_train)
    test_r2 = model.score(X_test, y_test)
    print(f"train R^2={train_r2:.3f}  test R^2={test_r2:.3f}")
    for name, importance in sorted(zip(FEATURE_NAMES, model.feature_importances_), key=lambda t: -t[1]):
        print(f"  {name:35s} {importance:.3f}")

    save_model(model)
    print(f"Saved model to {os.path.abspath('model.joblib')}  (source={args.source})")


if __name__ == "__main__":
    main()
