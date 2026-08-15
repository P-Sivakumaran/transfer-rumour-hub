import json
from pathlib import Path
from typing import Optional

import joblib
import numpy as np

from app.forecasting.calibration import uncertainty_band

MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "forecast_model.joblib"
METADATA_PATH = Path(__file__).resolve().parent.parent.parent / "forecast_model_metadata.json"


class ForecastBundle:
    def __init__(self, model, calibrator, feature_names, metadata: dict):
        self.model = model
        self.calibrator = calibrator
        self.feature_names = feature_names
        self.metadata = metadata

    def to_feature_vector(self, features: dict) -> np.ndarray:
        # Missing keys default to 0.0 rather than raising — matches the
        # feature vector's own missing-value convention (explicit
        # has*/is* flags carry the "is this actually known" signal, not
        # the presence/absence of the dict key itself).
        return np.array([[features.get(name, 0.0) for name in self.feature_names]])

    def predict(self, features: dict) -> dict:
        X = self.to_feature_vector(features)
        raw_score = float(self.model.predict_proba(X)[0, 1])
        calibrated = float(self.calibrator.predict([raw_score])[0])
        low, high = uncertainty_band(calibrated, self.metadata.get("calibrationCurve", []))
        return {
            "rawScore": raw_score,
            "calibratedProbability": calibrated,
            "uncertaintyLow": low,
            "uncertaintyHigh": high,
            "modelVersion": self.metadata.get("version", "unknown"),
        }


def load_forecast_model() -> Optional[ForecastBundle]:
    if not MODEL_PATH.exists() or not METADATA_PATH.exists():
        return None
    artifact = joblib.load(MODEL_PATH)
    metadata = json.loads(METADATA_PATH.read_text())
    return ForecastBundle(artifact["model"], artifact["calibrator"], artifact["feature_names"], metadata)
