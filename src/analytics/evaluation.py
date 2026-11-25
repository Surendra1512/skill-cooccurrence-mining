"""Evaluation: Apriori vs FP-Growth and rule-set stability.

Both algorithms receive the *same* one-hot matrix and thresholds, so any
difference in output would indicate an implementation problem; the expected
result is identical itemsets/rules with different execution times.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import pandas as pd

from config.settings import MiningConfig
from src.mining.association_rules import generate_rules
from src.mining.engine import mine_itemsets
from src.mining.lift_filter import filter_rules


@dataclass(frozen=True)
class AlgorithmRun:
    algorithm: str
    seconds: float
    itemsets: int
    rules_generated: int
    rules_surviving: int


@dataclass(frozen=True)
class AlgorithmComparison:
    runs: tuple[AlgorithmRun, ...]
    identical_itemsets: bool
    itemset_jaccard: float
    max_support_difference: float
    identical_surviving_rules: bool
    n_transactions: int
    config: dict[str, Any]

    def as_frame(self) -> pd.DataFrame:
        return pd.DataFrame([asdict(run) for run in self.runs])


def jaccard(a: set[Any], b: set[Any]) -> float:
    """Jaccard similarity; two empty sets are identical (1.0)."""
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def _rule_keys(rules: pd.DataFrame) -> set[tuple[frozenset[str], frozenset[str]]]:
    return set(zip(rules["antecedents"], rules["consequents"]))


def compare_algorithms(onehot: pd.DataFrame, config: MiningConfig, repeats: int = 1) -> AlgorithmComparison:
    """Run Apriori and FP-Growth with identical inputs and compare outputs."""
    runs: list[AlgorithmRun] = []
    outputs: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
    for algorithm in ("Apriori", "FP-Growth"):
        timings = []
        result = None
        for _ in range(max(1, repeats)):
            result = mine_itemsets(onehot, algorithm, config.min_support, config.max_len)
            timings.append(result.seconds)
        assert result is not None
        rules = generate_rules(result, 0.0)
        surviving = filter_rules(rules, config.min_support, config.min_confidence, config.min_lift).rules
        outputs[algorithm] = (result.itemsets, surviving)
        runs.append(
            AlgorithmRun(algorithm, float(np.median(timings)), len(result.itemsets), len(rules), len(surviving))
        )

    ap_items, ap_rules = outputs["Apriori"]
    fp_items, fp_rules = outputs["FP-Growth"]
    ap_support = dict(zip(ap_items["itemsets"], ap_items["support"]))
    fp_support = dict(zip(fp_items["itemsets"], fp_items["support"]))
    common = set(ap_support) & set(fp_support)
    max_diff = max((abs(ap_support[k] - fp_support[k]) for k in common), default=0.0)

    return AlgorithmComparison(
        runs=tuple(runs),
        identical_itemsets=set(ap_support) == set(fp_support),
        itemset_jaccard=jaccard(set(ap_support), set(fp_support)),
        max_support_difference=float(max_diff),
        identical_surviving_rules=_rule_keys(ap_rules) == _rule_keys(fp_rules),
        n_transactions=len(onehot),
        config=asdict(config),
    )


def write_evaluation_report(
    path: Path,
    preprocessing_report: dict[str, Any],
    comparison: AlgorithmComparison,
    rule_summary: dict[str, Any],
    baseline_rows: Sequence[dict[str, Any]],
    temporal_summary: dict[str, Any],
) -> None:
    """Write a Markdown evaluation report and a JSON twin next to it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    runs = comparison.as_frame()
    lines = [
        "# Evaluation Report",
        "",
        "All numbers below were computed by `python -m scripts.run_evaluation` on the processed dataset.",
        "",
        "## 1. Data",
        f"- Original records: {preprocessing_report['original_records']:,}",
        f"- Transactions mined: {comparison.n_transactions:,}",
        f"- Unique skills: {preprocessing_report['unique_skills']}",
        f"- Average skills per posting: {preprocessing_report['avg_skills_per_transaction']}",
        "",
        "## 2. Configuration",
        "```json",
        json.dumps(comparison.config, indent=2),
        "```",
        "",
        "## 3. Apriori vs FP-Growth",
        "| Algorithm | Time (s) | Frequent itemsets | Rules generated | Rules surviving filters |",
        "|---|---:|---:|---:|---:|",
        *[
            f"| {r.algorithm} | {r.seconds:.2f} | {r.itemsets:,} | {r.rules_generated:,} | {r.rules_surviving:,} |"
            for r in runs.itertuples()
        ],
        "",
        f"- Identical frequent itemsets: **{comparison.identical_itemsets}** (Jaccard {comparison.itemset_jaccard:.4f})",
        f"- Maximum support difference on shared itemsets: {comparison.max_support_difference:.2e}",
        f"- Identical surviving rule sets: **{comparison.identical_surviving_rules}**",
        "",
        "## 4. Rule set",
        *[f"- {k.replace('_', ' ').capitalize()}: {v}" for k, v in rule_summary.items()],
        "",
        "## 5. Baseline (individual frequency) vs association mining",
        "Pairs of the most frequent skills, ordered as a frequency-only planner would rank them, "
        "with the lift actually observed:",
        "",
        "| Skill A | Skill B | Observed support | Expected if independent | Lift |",
        "|---|---|---:|---:|---:|",
        *[
            f"| {r['skill_a']} | {r['skill_b']} | {r['observed_support']:.4f} | "
            f"{r['expected_support']:.4f} | {r['lift']:.2f} |"
            for r in baseline_rows
        ],
        "",
        "## 6. Temporal stability",
        *[f"- {k.replace('_', ' ').capitalize()}: {v}" for k, v in temporal_summary.items()],
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    payload = {
        "comparison": {**asdict(comparison), "runs": [asdict(r) for r in comparison.runs]},
        "rule_summary": rule_summary,
        "baseline_pairs": list(baseline_rows),
        "temporal": temporal_summary,
    }
    path.with_suffix(".json").write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
