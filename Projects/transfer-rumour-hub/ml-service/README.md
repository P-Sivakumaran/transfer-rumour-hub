# ML scoring service

FastAPI + scikit-learn RandomForest, the swap path `backend/src/scoring/
likelihoodEngine.ts` was written for. **Opt-in and off by default** — the
Node backend only calls this if `MODEL_SERVICE_URL` is set in
`backend/.env`, and falls back to the heuristic engine on any error,
timeout, or 503.

## Why it isn't trained on anything yet

As of this writing the dev DB has **0 FAILED/DENIED rumours** — outcome
detection (`backend/src/ingestion/outcomeDetector.ts`) has never produced a
negative. A RandomForest needs both classes. `train.py` checks this
(`MIN_PER_CLASS`, default 5 per class) and refuses to write a model until
there's enough labeled data — it exits 1 with a message instead of silently
training on one class or on fabricated data.

Nothing else is blocked on this: `/score` returns 503 until a model exists,
and the backend already treats that as "use the heuristic," so the site
works exactly as it does today either way.

### How this resolves itself

`backend/src/queue/workers.ts` now writes a `ScoringSnapshot` row (the exact
feature values used) every time a rumour is scored. Once real rumours start
resolving to COMPLETED / FAILED / DENIED — via the RSS outcome detector or an
admin marking a rumour resolved — those snapshots + their outcome become the
training set. No code changes needed; just re-run `train.py` once there's
enough of both classes.

## Setup

```bash
cd ml-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Train

```bash
export DATABASE_URL="postgresql://user@localhost:5432/transfer_hub"  # same as backend/.env
python train.py
```

Prints class counts and cross-val ROC-AUC, writes `model.joblib` +
`metadata.json` (feature importances, sample counts, trained_at) on success.

## Serve

```bash
uvicorn app:app --port 8000
```

Then in `backend/.env`:

```
MODEL_SERVICE_URL="http://localhost:8000"
```

Restart the backend (or nothing — it reads the env var per-request) and
`processScore` in `workers.ts` starts trying the model first.

## Retraining later

Re-run `python train.py` any time, then `curl -X POST localhost:8000/reload`
to hot-swap the new model without restarting `uvicorn`.

## Feature set

See `features.py` — the single source of truth shared by `train.py` and
`app.py` so the vector a model is trained on always matches what it's served
with. `clubNeedScore` is intentionally excluded: every caller in the Node
backend currently hardcodes it to `0.6` (real club-need computation is a
separate, still-open roadmap item), so it's zero-variance and would only add
noise.
