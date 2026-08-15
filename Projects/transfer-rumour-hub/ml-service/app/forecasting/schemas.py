from typing import Dict, List, Optional

from pydantic import BaseModel


class ForecastScoreRequest(BaseModel):
    """Features arrive as a flat dict, computed once in
    backend/src/forecasting/featureSnapshot.ts. Deliberately NOT re-derived
    here — the likelihood model (app/heuristic.py) duplicates its feature
    logic between TS and Python by hand and has to be "kept in lockstep"
    manually (see that file's own docstring); this pipeline avoids that
    entirely by keeping feature engineering in exactly one place (TS) and
    treating Python purely as the model-math layer.
    """

    features: Dict[str, float]
    forecastDefinitionVersion: int


class ForecastScoreResponse(BaseModel):
    rawScore: float
    calibratedProbability: float
    uncertaintyLow: float
    uncertaintyHigh: float
    modelVersion: str


class CalibrationBin(BaseModel):
    binLow: float
    binHigh: float
    meanPredicted: float
    empiricalRate: float
    n: int


class ForecastHealthResponse(BaseModel):
    trained: bool
    modelVersion: Optional[str] = None
    trainingDataSource: Optional[str] = None
    nTrainSamples: Optional[int] = None
    nTestSamples: Optional[int] = None
    brierScore: Optional[float] = None
    logLoss: Optional[float] = None
    calibrationCurve: Optional[List[CalibrationBin]] = None
