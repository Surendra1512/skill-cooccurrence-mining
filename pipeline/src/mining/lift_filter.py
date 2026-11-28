"""Threshold filtering and transparent ranking of association rules.

Filtering removes rules failing minimum support, confidence or lift (applied
in that order so the dashboard can show how many rules each stage removes).

Ranking score (all components min-max scaled to [0, 1] over the surviving
rules, so the score is relative to the current selection)::

    score = w_lift · scale(log2 lift) + w_conf · scale(confidence) + w_sup · scale(log10 support)

Logs are used for lift and support because both are heavily right-skewed;
without them a handful of extreme values would dominate the scale. The
weights default to 0.4 / 0.4 / 0.2 and are user-configurable, so no single
metric — in particular high lift on tiny support — decides the ranking alone.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config.settings import RankingWeights


@dataclass(frozen=True)
class FilterResult:
    """Rules surviving all thresholds plus per-stage counts."""

    rules: pd.DataFrame
    generated: int
    after_support: int
    after_confidence: int
    after_lift: int

    @property
    def stage_counts(self) -> dict[str, int]:
        return {
            "Generated": self.generated,
            "≥ min support": self.after_support,
            "≥ min confidence": self.after_confidence,
            "≥ min lift": self.after_lift,
        }


def filter_rules(rules: pd.DataFrame, min_support: float, min_confidence: float, min_lift: float) -> FilterResult:
    """Apply support → confidence → lift thresholds sequentially."""
    stage1 = rules[rules["support"] >= min_support]
    stage2 = stage1[stage1["confidence"] >= min_confidence]
    stage3 = stage2[stage2["lift"] >= min_lift]
    return FilterResult(
        rules=stage3.reset_index(drop=True),
        generated=len(rules),
        after_support=len(stage1),
        after_confidence=len(stage2),
        after_lift=len(stage3),
    )


def _min_max(values: pd.Series) -> pd.Series:
    low, high = float(values.min()), float(values.max())
    if not np.isfinite(low) or not np.isfinite(high) or high - low < 1e-12:
        return pd.Series(1.0, index=values.index)
    return (values - low) / (high - low)


def rank_rules(rules: pd.DataFrame, weights: RankingWeights | None = None) -> pd.DataFrame:
    """Add ``score`` and ``rank`` columns and sort strongest first."""
    if rules.empty:
        return rules.assign(score=pd.Series(dtype=float), rank=pd.Series(dtype=int))
    w_lift, w_conf, w_sup = (weights or RankingWeights()).normalised()
    lift_component = _min_max(np.log2(rules["lift"].clip(lower=1e-9)))
    conf_component = _min_max(rules["confidence"])
    sup_component = _min_max(np.log10(rules["support"].clip(lower=1e-12)))
    ranked = rules.assign(score=w_lift * lift_component + w_conf * conf_component + w_sup * sup_component)
    ranked = ranked.sort_values(["score", "lift", "support"], ascending=False, ignore_index=True)
    ranked["rank"] = np.arange(1, len(ranked) + 1)
    return ranked


def lift_interpretation(lift: float, tolerance: float = 0.05) -> str:
    """Plain-language reading of a lift value."""
    if lift > 1 + tolerance:
        return "positive association (together more often than chance)"
    if lift < 1 - tolerance:
        return "negative association (together less often than chance)"
    return "approximately independent"


def strongest_combinations(ranked: pd.DataFrame, top_n: int = 20) -> pd.DataFrame:
    """Collapse rule directions into skill combinations (itemsets).

    ``A → B`` and ``B → A`` describe the same combination {A, B}; keep the
    best-scoring direction per combination.
    """
    if ranked.empty:
        return ranked
    combos = ranked.assign(combination=[a | c for a, c in zip(ranked["antecedents"], ranked["consequents"])])
    combos = combos.sort_values("score", ascending=False).drop_duplicates("combination")
    return combos.head(top_n).reset_index(drop=True)
