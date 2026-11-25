"""Temporal analysis: how the strongest skill combinations shift over time.

Method
------
1. Assign each dated posting to a period (quarter by default).
2. Periods with fewer than ``min_transactions_per_period`` postings are
   excluded (and reported) because their metrics would be unreliable.
3. Rules are mined independently in every eligible period with the same
   thresholds, giving each period's top-K rule set.
4. The union of those top-K rules is *re-evaluated* in every period, so each
   tracked rule has support/confidence/lift for every period — including
   periods where it fell below the thresholds.
5. A rule is *emerging* (or *declining*) when its support changes by at least
   ``trend_min_relative_change`` between the first and last eligible period
   in the same direction as the least-squares slope across all periods.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from config.settings import MiningConfig, RankingWeights, TemporalConfig
from src.analytics.evaluation import jaccard
from src.mining.association_rules import evaluate_rules_on, itemset_label
from src.mining.base import MiningError
from src.mining.engine import run_mining
from src.preprocessing.transaction_builder import one_hot_encode


@dataclass(frozen=True)
class TemporalResult:
    periods: list[str]
    period_sizes: pd.Series
    excluded_periods: dict[str, int]
    rule_trends: pd.DataFrame  # long: rule, period, support, confidence, lift, support_count
    trend_summary: pd.DataFrame  # one row per tracked rule with trend classification
    top_rules_by_period: dict[str, list[str]]
    stability: pd.DataFrame  # period_a, period_b, jaccard
    messages: list[str] = field(default_factory=list)


def assign_periods(postings: pd.DataFrame, frequency: str) -> pd.Series:
    """Period label per posting (NaN for undated postings)."""
    labels = postings["posted_at"].dt.to_period(frequency).astype(str)
    return labels.where(postings["posted_at"].notna())


def _rule_key(antecedents: frozenset[str], consequents: frozenset[str], labels: dict[str, str]) -> str:
    return f"{itemset_label(antecedents, labels)} → {itemset_label(consequents, labels)}"


def _slope(values: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    x = np.arange(len(values), dtype=float)
    return float(np.polyfit(x, values, 1)[0])


def classify_trend(supports: np.ndarray, min_relative_change: float) -> tuple[str, float]:
    """Return (trend label, relative change first→last) for a support series."""
    first, last = float(supports[0]), float(supports[-1])
    if first <= 0:
        return ("emerging" if last > 0 else "stable"), (np.inf if last > 0 else 0.0)
    change = (last - first) / first
    slope = _slope(supports)
    if change >= min_relative_change and slope > 0:
        return "emerging", change
    if change <= -min_relative_change and slope < 0:
        return "declining", change
    return "stable", change


def analyse_temporal(
    postings: pd.DataFrame,
    mining_config: MiningConfig,
    temporal_config: TemporalConfig,
    labels: dict[str, str],
    weights: RankingWeights | None = None,
) -> TemporalResult:
    """Mine each period and track the strongest rules across periods."""
    messages: list[str] = []
    period_labels = assign_periods(postings, temporal_config.frequency)
    undated = int(period_labels.isna().sum())
    if undated:
        messages.append(f"{undated:,} postings without a valid date were excluded from temporal analysis.")

    sizes = period_labels.value_counts().sort_index()
    eligible = [p for p, n in sizes.items() if n >= temporal_config.min_transactions_per_period]
    excluded = {p: int(n) for p, n in sizes.items() if p not in eligible}
    if excluded:
        messages.append(
            "Periods below the minimum of "
            f"{temporal_config.min_transactions_per_period:,} postings were excluded: "
            + ", ".join(f"{p} ({n:,})" for p, n in excluded.items())
        )
    if len(eligible) < 2:
        raise MiningError(
            "Temporal analysis needs at least two periods with enough postings; "
            f"found {len(eligible)}. Try monthly periods, a broader selection or a lower minimum."
        )

    vocabulary = sorted({s for skills in postings["skills"] for s in skills})
    onehots: dict[str, pd.DataFrame] = {}
    top_rules: dict[str, pd.DataFrame] = {}
    for period in eligible:
        subset = postings.loc[period_labels == period, "skills"]
        onehots[period] = one_hot_encode(subset, vocabulary=vocabulary)
        outcome = run_mining(onehots[period], mining_config, weights)
        top_rules[period] = outcome.ranked.head(temporal_config.top_k_rules)

    tracked = (
        pd.concat(top_rules.values(), ignore_index=True)[["antecedents", "consequents"]]
        .drop_duplicates()
        .reset_index(drop=True)
    )
    if tracked.empty:
        raise MiningError("No rule survived the thresholds in any period; relax the thresholds.")
    tracked["rule"] = [_rule_key(a, c, labels) for a, c in zip(tracked["antecedents"], tracked["consequents"])]

    frames = []
    for period in eligible:
        metrics = evaluate_rules_on(onehots[period], tracked)
        frames.append(metrics.assign(rule=tracked["rule"].values, period=period))
    trends = pd.concat(frames, ignore_index=True)

    summary_rows = []
    for rule, group in trends.groupby("rule", sort=False):
        group = group.set_index("period").loc[eligible]
        label, change = classify_trend(group["support"].to_numpy(), temporal_config.trend_min_relative_change)
        summary_rows.append(
            {
                "rule": rule,
                "trend": label,
                "support_first": group["support"].iloc[0],
                "support_last": group["support"].iloc[-1],
                "support_change": change,
                "confidence_first": group["confidence"].iloc[0],
                "confidence_last": group["confidence"].iloc[-1],
                "lift_first": group["lift"].iloc[0],
                "lift_last": group["lift"].iloc[-1],
                "periods_in_top_k": sum(
                    rule in {_rule_key(a, c, labels) for a, c in zip(t["antecedents"], t["consequents"])}
                    for t in top_rules.values()
                ),
            }
        )
    summary = pd.DataFrame(summary_rows).sort_values("support_change", ascending=False, ignore_index=True)

    top_keys = {
        p: [_rule_key(a, c, labels) for a, c in zip(t["antecedents"], t["consequents"])]
        for p, t in top_rules.items()
    }
    stability = pd.DataFrame(
        [
            {"period_a": a, "period_b": b, "jaccard": jaccard(set(top_keys[a]), set(top_keys[b]))}
            for a, b in zip(eligible[:-1], eligible[1:])
        ]
    )
    messages.append(
        f"Coverage is {eligible[0]} to {eligible[-1]} ({len(eligible)} periods). Trends describe this window "
        "only and should not be extrapolated."
    )
    return TemporalResult(
        periods=eligible,
        period_sizes=sizes,
        excluded_periods=excluded,
        rule_trends=trends,
        trend_summary=summary,
        top_rules_by_period=top_keys,
        stability=stability,
        messages=messages,
    )
