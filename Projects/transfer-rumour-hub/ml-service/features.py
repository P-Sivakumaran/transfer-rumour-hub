"""
Shared feature engineering — imported by both train.py and app.py so the
vector a model is trained on is guaranteed identical to the one it's served
with. Do not duplicate this logic elsewhere.

clubNeedScore is deliberately excluded: every caller in the Node backend
currently hardcodes it to 0.6 (see workers.ts), so it's zero-variance and
would just add noise to the split search.
"""
from __future__ import annotations

FEATURE_NAMES = [
    "source_reliability",
    "months_to_expiry",
    "months_to_expiry_missing",
    "fee_mid",
    "fee_missing",
    "market_value",
    "market_value_missing",
    "fee_to_value_ratio",
    "distinct_source_count",
    "base_probability",
    "base_probability_missing",
]


def extract_features(inputs: dict) -> list[float]:
    source_reliability = float(inputs.get("sourceReliability") or 0.5)

    months = inputs.get("monthsToContractExpiry")
    months_missing = months is None
    months_val = float(months) if months is not None else -1.0

    fee_min = inputs.get("reportedFeeMin")
    fee_max = inputs.get("reportedFeeMax")
    if fee_min is not None and fee_max is not None:
        fee_mid = (float(fee_min) + float(fee_max)) / 2
        fee_missing = False
    elif fee_min is not None or fee_max is not None:
        fee_mid = float(fee_min if fee_min is not None else fee_max)
        fee_missing = False
    else:
        fee_mid = 0.0
        fee_missing = True

    market_value = inputs.get("marketValue")
    market_value_missing = market_value is None
    market_value_val = float(market_value) if market_value is not None else 0.0

    if not fee_missing and not market_value_missing and market_value_val > 0:
        fee_to_value_ratio = fee_mid / market_value_val
    else:
        fee_to_value_ratio = 1.0  # neutral — neither over- nor under-priced

    distinct_source_count = float(inputs.get("distinctSourceCount") or 1)

    base_probability = inputs.get("baseProbability")
    base_probability_missing = base_probability is None
    base_probability_val = float(base_probability) if base_probability is not None else 0.5

    return [
        source_reliability,
        months_val,
        1.0 if months_missing else 0.0,
        fee_mid,
        1.0 if fee_missing else 0.0,
        market_value_val,
        1.0 if market_value_missing else 0.0,
        fee_to_value_ratio,
        distinct_source_count,
        base_probability_val,
        1.0 if base_probability_missing else 0.0,
    ]
