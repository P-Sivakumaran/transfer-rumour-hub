from fastapi import FastAPI

from app.heuristic import heuristic_score
from app.model import load_model, to_feature_vector
from app.schemas import ScoringInputs, ScoringOutput

app = FastAPI(title="transfer-rumour-hub ML scoring service")

model = load_model()


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/score", response_model=ScoringOutput)
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
