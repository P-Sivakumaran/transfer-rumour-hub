from typing import Optional

from pydantic import BaseModel, Field


class ScoringInputs(BaseModel):
    """Mirrors backend/src/scoring/likelihoodEngine.ts::ScoringInputs exactly.
    Field names/types must stay in sync or the swap silently produces garbage scores."""

    sourceReliability: float = Field(ge=0, le=1)
    monthsToContractExpiry: Optional[float] = None
    reportedFeeMin: Optional[float] = None
    reportedFeeMax: Optional[float] = None
    marketValue: Optional[float] = None
    clubNeedScore: float = Field(ge=0, le=1)
    distinctSourceCount: int = Field(ge=0)
    baseProbability: Optional[float] = None


class ScoringBreakdown(BaseModel):
    source: float
    contract: float
    feeAlignment: float
    clubNeed: float
    sourceCount: float
    providerBonus: float


class ScoringOutput(BaseModel):
    score: float
    breakdown: ScoringBreakdown
