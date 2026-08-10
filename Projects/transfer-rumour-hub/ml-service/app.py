"""
Model-serving microservice for rumour likelihood scoring.

Opt-in from the Node backend via MODEL_SERVICE_URL — see backend/src/scoring/
mlScorer.ts. Until train.py has produced a model (gated on having outcome
data for both classes), /score returns 503 and the backend falls back to
the heuristic engine. Nothing depends on this service being up.
"""
from __future__ import annotations

import json
import os
from typing import Optional

import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from features import extract_features

MODEL_PATH = os.environ.get("MODEL_PATH", "model.joblib")
METADATA_PATH = os.environ.get("METADATA_PATH", "metadata.json")

app = FastAPI(title="transfer-rumour-hub model service")

_state: dict = {"model": None, "metadata": None}


class ScoringInputs(BaseModel):
    sourceReliability: float
    monthsToContractExpiry: Optional[float] = None
    reportedFeeMin: Optional[float] = None
    reportedFeeMax: Optional[float] = None
    marketValue: Optional[float] = None
    clubNeedScore: Optional[float] = None  # accepted, unused — see features.py
    distinctSourceCount: int = 1
    baseProbability: Optional[float] = None


def _load_model() -> None:
    if os.path.exists(MODEL_PATH):
        _state["model"] = joblib.load(MODEL_PATH)
    else:
        _state["model"] = None

    if os.path.exists(METADATA_PATH):
        with open(METADATA_PATH) as f:
            _state["metadata"] = json.load(f)
    else:
        _state["metadata"] = None


@app.on_event("startup")
def startup() -> None:
    _load_model()


@app.post("/reload")
def reload_model() -> dict:
    """Hot-swap the model after train.py produces a fresh model.joblib, no restart needed."""
    _load_model()
    return {"loaded": _state["model"] is not None, "metadata": _state["metadata"]}


@app.get("/health")
def health() -> dict:
    return {"model_loaded": _state["model"] is not None, "metadata": _state["metadata"]}


@app.post("/score")
def score(inputs: ScoringInputs) -> dict:
    model = _state["model"]
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="No trained model yet — not enough labeled outcomes. Caller should fall back to the heuristic.",
        )

    features = [extract_features(inputs.model_dump())]
    probability_completed = model.predict_proba(features)[0][1]
    return {
        "score": round(probability_completed * 100, 1),
        "modelTrainedAt": _state["metadata"]["trained_at"] if _state["metadata"] else None,
    }
