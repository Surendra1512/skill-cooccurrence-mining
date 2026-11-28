"""Association-rule generation and metric computation.

For a rule A → B over N transactions:

* support(A → B)    = P(A ∪ B)          = count(A ∪ B) / N
* confidence(A → B) = P(A ∪ B) / P(A)
* lift(A → B)       = confidence(A → B) / P(B)

``A ∪ B`` means "postings containing every skill of A and of B".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np
import pandas as pd
from mlxtend.frequent_patterns import association_rules as mlx_association_rules

from src.mining.base import ItemsetResult

RULE_COLUMNS: tuple[str, ...] = (
    "antecedents",
    "consequents",
    "antecedent_support",
    "consequent_support",
    "support",
    "confidence",
    "lift",
    "leverage",
    "conviction",
    "support_count",
    "antecedent_len",
    "consequent_len",
)


def generate_rules(result: ItemsetResult, min_confidence: float = 0.0) -> pd.DataFrame:
    """Generate all rules (single or multi-skill on either side) from itemsets.

    Rules are produced from every frequent itemset of length ≥ 2, so the
    support threshold is already enforced by the miner. ``min_confidence`` is
    applied here to bound the output size; lift is filtered downstream.
    """
    itemsets = result.itemsets
    if itemsets.empty or itemsets["length"].max() < 2:
        return pd.DataFrame(columns=list(RULE_COLUMNS))

    rules = mlx_association_rules(
        itemsets[["support", "itemsets"]],
        metric="confidence",
        min_threshold=min_confidence,
        num_itemsets=result.n_transactions,
    )
    if rules.empty:
        return pd.DataFrame(columns=list(RULE_COLUMNS))

    rules = rules.rename(columns={"antecedent support": "antecedent_support", "consequent support": "consequent_support"})
    rules["antecedents"] = rules["antecedents"].map(frozenset)
    rules["consequents"] = rules["consequents"].map(frozenset)
    rules["support_count"] = (rules["support"] * result.n_transactions).round().astype(int)
    rules["antecedent_len"] = rules["antecedents"].map(len)
    rules["consequent_len"] = rules["consequents"].map(len)
    rules["conviction"] = rules["conviction"].replace([np.inf], np.nan)
    return rules[list(RULE_COLUMNS)].reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Direct (reference) metric computation
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RuleMetrics:
    """Metrics of a single rule computed directly from transactions."""

    support: float
    confidence: float
    lift: float
    support_count: int
    antecedent_count: int
    consequent_count: int
    n_transactions: int


def compute_rule_metrics(
    transactions: Sequence[Iterable[str]], antecedent: Iterable[str], consequent: Iterable[str]
) -> RuleMetrics:
    """Compute support, confidence and lift by brute-force counting.

    Used to validate the library output and to evaluate fixed rules on new
    subsets of data (e.g. time periods).
    """
    a, c = frozenset(antecedent), frozenset(consequent)
    if not a or not c:
        raise ValueError("Antecedent and consequent must be non-empty.")
    if a & c:
        raise ValueError("Antecedent and consequent must be disjoint.")

    sets = [frozenset(t) for t in transactions]
    n = len(sets)
    count_a = sum(1 for t in sets if a <= t)
    count_c = sum(1 for t in sets if c <= t)
    count_ac = sum(1 for t in sets if (a | c) <= t)
    support = count_ac / n if n else 0.0
    confidence = count_ac / count_a if count_a else 0.0
    p_c = count_c / n if n else 0.0
    lift = confidence / p_c if p_c else 0.0
    return RuleMetrics(support, confidence, lift, count_ac, count_a, count_c, n)


def evaluate_rules_on(onehot: pd.DataFrame, rules: pd.DataFrame) -> pd.DataFrame:
    """Vectorised metrics of fixed rules recomputed on another one-hot matrix.

    Skills missing from ``onehot`` count as never present. Returns columns
    ``support, confidence, lift, support_count, antecedent_count`` aligned to
    ``rules.index``.
    """
    n = len(onehot)
    matrix = onehot.to_numpy(dtype=bool)
    position = {skill: i for i, skill in enumerate(onehot.columns)}
    zeros = np.zeros(n, dtype=bool)

    def presence(items: frozenset[str]) -> np.ndarray:
        if any(item not in position for item in items):
            return zeros
        return matrix[:, [position[item] for item in items]].all(axis=1)

    records = []
    for antecedents, consequents in zip(rules["antecedents"], rules["consequents"]):
        has_a = presence(antecedents)
        has_c = presence(consequents)
        count_a, count_c = int(has_a.sum()), int(has_c.sum())
        count_ac = int((has_a & has_c).sum())
        support = count_ac / n if n else 0.0
        confidence = count_ac / count_a if count_a else 0.0
        p_c = count_c / n if n else 0.0
        records.append(
            {
                "support": support,
                "confidence": confidence,
                "lift": confidence / p_c if p_c else 0.0,
                "support_count": count_ac,
                "antecedent_count": count_a,
            }
        )
    return pd.DataFrame(records, index=rules.index)


def itemset_label(items: Iterable[str], labels: dict[str, str] | None = None, sep: str = " + ") -> str:
    """Stable, readable label for a set of skills."""
    names = sorted((labels.get(i, i) if labels else i) for i in items)
    return sep.join(names)
