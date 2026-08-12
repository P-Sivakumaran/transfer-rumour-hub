"""Feature vector construction + model load/predict.

Nullable ScoringInputs fields are encoded as (imputed_value, is_missing_flag)
pairs so the model can learn "unknown" as distinct from "known and low/high" —
same reasoning the heuristic engine uses with its explicit None branches.
"""
from pathlib import Path
from typing import Optional

import joblib
import numpy as np

from app.schemas import ScoringInputs

MODEL_PATH = Path(__file__).resolve().parent.parent / "model.joblib"

FEATURE_NAMES = [
    "sourceReliability",
    "monthsToContractExpiry",
    "monthsToContractExpiry_missing",
    "feeMid",
    "feeMid_missing",
    "marketValue",
    "marketValue_missing",
    "clubNeedScore",
    "distinctSourceCount",
    "baseProbability",
    "baseProbability_missing",
]


def _fee_mid(inputs: ScoringInputs) -> Optional[float]:
    if inputs.reportedFeeMin is not None and inputs.reportedFeeMax is not None:
        return (inputs.reportedFeeMin + inputs.reportedFeeMax) / 2
    return inputs.reportedFeeMin if inputs.reportedFeeMin is not None else inputs.reportedFeeMax


def to_feature_vector(inputs: ScoringInputs) -> np.ndarray:
    fee_mid = _fee_mid(inputs)
    return np.array(
        [
            inputs.sourceReliability,
            inputs.monthsToContractExpiry if inputs.monthsToContractExpiry is not None else 0.0,
            1.0 if inputs.monthsToContractExpiry is None else 0.0,
            fee_mid if fee_mid is not None else 0.0,
            1.0 if fee_mid is None else 0.0,
            inputs.marketValue if inputs.marketValue is not None else 0.0,
            1.0 if inputs.marketValue is None else 0.0,
            inputs.clubNeedScore,
            inputs.distinctSourceCount,
            inputs.baseProbability if inputs.baseProbability is not None else 0.0,
            1.0 if inputs.baseProbability is None else 0.0,
        ],
        dtype=float,
    )


def load_model():
    if not MODEL_PATH.exists():
        return None
    return joblib.load(MODEL_PATH)


def save_model(model) -> None:
    joblib.dump(model, MODEL_PATH)
