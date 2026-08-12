"""Python port of backend/src/scoring/likelihoodEngine.ts::heuristicScore.

Used for: (1) the explainability breakdown returned alongside every ML score
(the RandomForest predicts a single number, it doesn't decompose additively),
(2) synthetic label generation in train.py while real COMPLETED/FAILED/DENIED
outcomes are too few to train on, and (3) a same-process fallback if no
trained model artifact is present.

Keep in lockstep with the TypeScript version — weights and formulas must match.
"""
import math

from app.schemas import ScoringBreakdown, ScoringInputs, ScoringOutput

WEIGHTS = {
    "source": 28,
    "contract": 20,
    "feeAlignment": 12,
    "clubNeed": 20,
    "sourceCount": 15,
    "providerBonus": 5,
}


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def heuristic_score(inputs: ScoringInputs) -> ScoringOutput:
    source = clamp(inputs.sourceReliability, 0, 1) * WEIGHTS["source"]

    if inputs.monthsToContractExpiry is not None:
        urgency = 1 - clamp(inputs.monthsToContractExpiry / 24, 0, 1)
        contract = urgency * WEIGHTS["contract"]
    else:
        contract = WEIGHTS["contract"] * 0.4

    fee = None
    if inputs.reportedFeeMin is not None and inputs.reportedFeeMax is not None:
        fee = (inputs.reportedFeeMin + inputs.reportedFeeMax) / 2
    elif inputs.reportedFeeMin is not None:
        fee = inputs.reportedFeeMin
    elif inputs.reportedFeeMax is not None:
        fee = inputs.reportedFeeMax

    if fee is not None and inputs.marketValue:
        ratio = fee / inputs.marketValue
        alignment = max(0.0, 1 - abs(ratio - 1) * 1.5)
        fee_alignment = alignment * WEIGHTS["feeAlignment"]
    else:
        fee_alignment = WEIGHTS["feeAlignment"] * 0.3

    club_need = clamp(inputs.clubNeedScore, 0, 1) * WEIGHTS["clubNeed"]

    source_count = min(1.0, 1 - math.exp(-inputs.distinctSourceCount * 0.5)) * WEIGHTS["sourceCount"]

    provider_bonus = (
        inputs.baseProbability * WEIGHTS["providerBonus"]
        if inputs.baseProbability
        else WEIGHTS["providerBonus"] * 0.5
    )

    raw = source + contract + fee_alignment + club_need + source_count + provider_bonus
    score = round(clamp(raw, 0, 100))

    return ScoringOutput(
        score=score,
        breakdown=ScoringBreakdown(
            source=round(source),
            contract=round(contract),
            feeAlignment=round(fee_alignment),
            clubNeed=round(club_need),
            sourceCount=round(source_count),
            providerBonus=round(provider_bonus),
        ),
    )
