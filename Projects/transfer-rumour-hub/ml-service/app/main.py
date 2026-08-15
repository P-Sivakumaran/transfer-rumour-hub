import os

from fastapi import Depends, FastAPI, Header, HTTPException

from app.heuristic import heuristic_score
from app.model import load_model, to_feature_vector
from app.schemas import ScoringInputs, ScoringOutput
from app.forecasting.model import load_forecast_model
from app.forecasting.schemas import ForecastHealthResponse, ForecastScoreRequest, ForecastScoreResponse

app = FastAPI(title="transfer-rumour-hub ML scoring service")

# Shared-secret check between the backend and this service (PoLP:
# docs/polp-security-dev-plan.md Phase 2). Mirrors the existing
# graceful-degradation pattern for optional secrets in this codebase
# (ML_SCORING_URL/STRIPE_SECRET_KEY, see entitlements/flags.ts) rather than
# the retired ADMIN_TOKEN shared-secret pattern: if ML_SERVICE_KEY isn't
# set, this is presumed to be local dev and the check is a no-op, not a
# fail-open bypass of real auth. /health is intentionally excluded — health
# checks (load balancers, container orchestration) shouldn't need a secret.
ML_SERVICE_KEY = os.environ.get("ML_SERVICE_KEY")


def require_service_key(x_ml_service_key: str | None = Header(default=None)) -> None:
    if ML_SERVICE_KEY is None:
        return
    if x_ml_service_key != ML_SERVICE_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing service key")

model = load_model()
forecast_bundle = load_forecast_model()  # None until train_forecast.py has run


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/forecast/score", response_model=ForecastScoreResponse, dependencies=[Depends(require_service_key)])
def forecast_score(req: ForecastScoreRequest) -> ForecastScoreResponse:
    # No fallback to the heuristic /score model here, by design — see
    # backend/src/forecasting/mlForecastClient.ts's docstring. An
    # unavailable calibrated model must surface as "can't answer", not as a
    # different, uncalibrated number silently standing in for it.
    if forecast_bundle is None:
        raise HTTPException(status_code=503, detail="Forecast model not trained yet")
    result = forecast_bundle.predict(req.features)
    return ForecastScoreResponse(**result)


@app.get("/forecast/health", response_model=ForecastHealthResponse, dependencies=[Depends(require_service_key)])
def forecast_health() -> ForecastHealthResponse:
    if forecast_bundle is None:
        return ForecastHealthResponse(trained=False)
    meta = forecast_bundle.metadata
    return ForecastHealthResponse(
        trained=True,
        modelVersion=meta.get("version"),
        trainingDataSource=meta.get("trainingDataSource"),
        nTrainSamples=meta.get("nTrainSamples"),
        nTestSamples=meta.get("nTestSamples"),
        brierScore=meta.get("brierScore"),
        logLoss=meta.get("logLoss"),
        calibrationCurve=meta.get("calibrationCurve"),
    )


@app.post("/score", response_model=ScoringOutput, dependencies=[Depends(require_service_key)])
def score(inputs: ScoringInputs) -> ScoringOutput:
    # Breakdown is always the heuristic decomposition — the forest predicts a
    # single number and doesn't decompose additively into these 6 components.
    breakdown = heuristic_score(inputs).breakdown

    if model is None:
        return heuristic_score(inputs)

    features = to_feature_vector(inputs).reshape(1, -1)
    predicted = float(model.predict(features)[0])
    predicted = max(0.0, min(100.0, predicted))

    return ScoringOutput(score=round(predicted), breakdown=breakdown)
