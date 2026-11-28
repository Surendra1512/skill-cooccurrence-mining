"""Frequent itemsets, rule generation, filtering, ranking, evaluation, temporal."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from config.settings import MiningConfig, RankingWeights, TemporalConfig
from src.analytics.evaluation import compare_algorithms, jaccard
from src.analytics.skill_frequency import baseline_vs_association, segment_frequency, skill_frequency
from src.analytics.temporal_analysis import analyse_temporal, assign_periods, classify_trend
from src.mining.apriori_miner import mine_apriori
from src.mining.association_rules import generate_rules
from src.mining.base import MiningError
from src.mining.engine import mine_itemsets, run_mining
from src.mining.fpgrowth_miner import mine_fpgrowth
from src.mining.lift_filter import filter_rules, lift_interpretation, rank_rules, strongest_combinations
from src.preprocessing.transaction_builder import one_hot_encode


# --------------------------------------------------------------------------- #
# Frequent itemsets
# --------------------------------------------------------------------------- #
def test_fpgrowth_itemsets_and_counts(onehot) -> None:
    result = mine_fpgrowth(onehot, min_support=0.4, max_len=3)
    supports = dict(zip(result.itemsets["itemsets"], result.itemsets["support_count"]))
    assert supports[frozenset({"python"})] == 4
    assert supports[frozenset({"python", "sql"})] == 3
    assert supports[frozenset({"python", "sql", "excel"})] == 2
    assert frozenset({"tableau"}) not in supports  # support 0.2 < 0.4


@pytest.mark.parametrize("min_support", [0.2, 0.4, 0.6])
def test_apriori_equals_fpgrowth(onehot, min_support) -> None:
    ap = mine_apriori(onehot, min_support, 4).itemsets
    fp = mine_fpgrowth(onehot, min_support, 4).itemsets
    assert dict(zip(ap["itemsets"], ap["support"])) == pytest.approx(dict(zip(fp["itemsets"], fp["support"])))


def test_max_len_respected(onehot) -> None:
    result = mine_fpgrowth(onehot, 0.2, 2)
    assert result.itemsets["length"].max() == 2


def test_empty_input_raises() -> None:
    with pytest.raises(MiningError):
        mine_fpgrowth(pd.DataFrame(), 0.1, 2)


def test_unknown_algorithm(onehot) -> None:
    with pytest.raises(MiningError):
        mine_itemsets(onehot, "Eclat", 0.2, 2)


def test_mining_config_validation() -> None:
    with pytest.raises(ValueError):
        MiningConfig(algorithm="Nope")
    with pytest.raises(ValueError):
        MiningConfig(min_support=0.0)
    with pytest.raises(ValueError):
        MiningConfig(max_len=1)


# --------------------------------------------------------------------------- #
# Rules
# --------------------------------------------------------------------------- #
def test_rules_include_multi_skill_sides(onehot) -> None:
    rules = generate_rules(mine_fpgrowth(onehot, 0.2, 4), 0.0)
    assert (rules["antecedent_len"] > 1).any()
    assert (rules["consequent_len"] > 1).any()
    assert (rules["antecedent_len"] == 1).any() and (rules["consequent_len"] == 1).any()
    assert all(not (a & c) for a, c in zip(rules["antecedents"], rules["consequents"]))


def test_no_rules_from_singletons_only(onehot) -> None:
    rules = generate_rules(mine_fpgrowth(onehot, 0.8, 2), 0.0)  # only singletons are frequent
    assert rules.empty


# --------------------------------------------------------------------------- #
# Filtering & ranking
# --------------------------------------------------------------------------- #
def _rules(onehot):
    return generate_rules(mine_fpgrowth(onehot, 0.2, 4), 0.0)


def test_filter_thresholds_and_stage_counts(onehot) -> None:
    rules = _rules(onehot)
    result = filter_rules(rules, min_support=0.4, min_confidence=0.6, min_lift=0.9)
    kept = result.rules
    assert (kept["support"] >= 0.4).all() and (kept["confidence"] >= 0.6).all() and (kept["lift"] >= 0.9).all()
    assert result.generated == len(rules)
    assert result.generated >= result.after_support >= result.after_confidence >= result.after_lift == len(kept)
    expected = rules[(rules["support"] >= 0.4) & (rules["confidence"] >= 0.6) & (rules["lift"] >= 0.9)]
    assert len(kept) == len(expected)


def test_lift_filter_removes_negative_associations(onehot) -> None:
    kept = filter_rules(_rules(onehot), 0.0, 0.0, 1.0).rules
    # In the fixture only rules involving tableau have lift > 1
    assert all("tableau" in (a | c) for a, c in zip(kept["antecedents"], kept["consequents"]))


def test_rank_rules_formula() -> None:
    rules = pd.DataFrame(
        {
            "antecedents": [frozenset({"a"}), frozenset({"b"}), frozenset({"c"})],
            "consequents": [frozenset({"x"}), frozenset({"y"}), frozenset({"z"})],
            "support": [0.01, 0.1, 0.001],
            "confidence": [0.5, 0.9, 0.3],
            "lift": [2.0, 4.0, 8.0],
        }
    )
    ranked = rank_rules(rules, RankingWeights(lift=1, confidence=0, support=0))
    assert ranked["lift"].tolist() == [8.0, 4.0, 2.0]
    assert ranked["score"].tolist() == pytest.approx([1.0, 0.5, 0.0])  # log2 lift scaled: 3,2,1
    assert ranked["rank"].tolist() == [1, 2, 3]

    balanced = rank_rules(rules, RankingWeights(0.4, 0.4, 0.2))
    w = np.array([0.4, 0.4, 0.2])
    expected_b = w @ np.array([0.5, 1.0, 1.0])  # rule b: lift .5, confidence 1, support 1
    assert balanced.set_index(balanced["antecedents"].map(lambda s: next(iter(s))))["score"]["b"] == pytest.approx(expected_b)
    assert balanced["score"].between(0, 1).all()


def test_rank_rules_empty_and_constant() -> None:
    empty = rank_rules(pd.DataFrame(columns=["support", "confidence", "lift"]))
    assert empty.empty
    one = rank_rules(pd.DataFrame({"antecedents": [frozenset("a")], "consequents": [frozenset("b")],
                                   "support": [0.1], "confidence": [0.5], "lift": [2.0]}))
    assert one["score"].iloc[0] == pytest.approx(1.0)


def test_ranking_weights_validation() -> None:
    with pytest.raises(ValueError):
        RankingWeights(0, 0, 0).normalised()
    assert sum(RankingWeights(2, 2, 1).normalised()) == pytest.approx(1.0)


def test_lift_interpretation() -> None:
    assert lift_interpretation(1.5).startswith("positive")
    assert lift_interpretation(1.0).startswith("approximately")
    assert lift_interpretation(0.5).startswith("negative")


def test_strongest_combinations_collapse_directions(onehot) -> None:
    ranked = rank_rules(_rules(onehot))
    combos = strongest_combinations(ranked, 100)
    assert combos["combination"].is_unique
    assert len(combos) < len(ranked)


def test_run_mining_end_to_end(onehot) -> None:
    outcome = run_mining(onehot, MiningConfig("Apriori", 0.2, 0.5, 1.0, 3))
    assert len(outcome.ranked) == outcome.filtered.after_lift
    assert outcome.ranked["score"].is_monotonic_decreasing


# --------------------------------------------------------------------------- #
# Baseline & evaluation
# --------------------------------------------------------------------------- #
def test_skill_frequency(transactions) -> None:
    freq = skill_frequency(transactions)
    assert freq["skill"].tolist() == ["excel", "python", "sql", "tableau"]  # ties alphabetical
    assert freq["postings"].tolist() == [4, 4, 4, 1]
    assert freq["share"].tolist() == pytest.approx([0.8, 0.8, 0.8, 0.2])
    assert freq["rank"].tolist() == [1, 2, 3, 4]


def test_segment_frequency(postings) -> None:
    seg = segment_frequency(postings, "role", skills=["tableau"])
    row = seg[seg["segment"] == "Data Scientist"].iloc[0]
    assert row["postings"] == 1 and row["segment_size"] == 2 and row["share"] == pytest.approx(0.5)


def test_baseline_vs_association(transactions) -> None:
    freq = skill_frequency(transactions)
    pairs = baseline_vs_association(transactions, freq, top_n=3).set_index(["skill_a", "skill_b"])
    row = pairs.loc[("excel", "python")]
    assert row["observed_support"] == pytest.approx(0.6)
    assert row["expected_support"] == pytest.approx(0.64)
    assert row["lift"] == pytest.approx(0.9375)


def test_compare_algorithms_consistent(onehot) -> None:
    comparison = compare_algorithms(onehot, MiningConfig("FP-Growth", 0.2, 0.3, 0.5, 4))
    assert comparison.identical_itemsets and comparison.identical_surviving_rules
    assert comparison.itemset_jaccard == 1.0
    assert comparison.max_support_difference == pytest.approx(0.0)
    assert {r.algorithm for r in comparison.runs} == {"Apriori", "FP-Growth"}


def test_jaccard() -> None:
    assert jaccard(set(), set()) == 1.0
    assert jaccard({1, 2}, {2, 3}) == pytest.approx(1 / 3)


# --------------------------------------------------------------------------- #
# Temporal
# --------------------------------------------------------------------------- #
def test_assign_periods(postings) -> None:
    assert assign_periods(postings, "Q").tolist() == ["2023Q1", "2023Q1", "2023Q2", "2023Q2", "2023Q2"]


@pytest.mark.parametrize(
    ("series", "label"),
    [([0.10, 0.12, 0.15], "emerging"), ([0.15, 0.12, 0.10], "declining"), ([0.10, 0.101, 0.102], "stable"),
     ([0.0, 0.05], "emerging")],
)
def test_classify_trend(series, label) -> None:
    assert classify_trend(np.array(series), 0.15)[0] == label


def _temporal_postings() -> pd.DataFrame:
    """Synthetic test data: python+pandas rises from Q1 to Q2, sql+excel falls."""
    rows = []
    for quarter, start, n_rising, n_falling in (("Q1", "2023-01-10", 10, 40), ("Q2", "2023-04-10", 40, 10)):
        for i in range(n_rising):
            rows.append((start, ["python", "pandas"]))
        for i in range(n_falling):
            rows.append((start, ["sql", "excel"]))
        for i in range(50):
            rows.append((start, ["java"]))
    return pd.DataFrame(
        {"posted_at": pd.to_datetime([r[0] for r in rows]), "skills": [r[1] for r in rows],
         "role": "x", "country": "y"}
    )


def test_analyse_temporal_detects_trends() -> None:
    result = analyse_temporal(
        _temporal_postings(),
        MiningConfig("FP-Growth", 0.05, 0.5, 1.0, 2),
        TemporalConfig(frequency="Q", min_transactions_per_period=50, top_k_rules=10, trend_min_relative_change=0.15),
        labels={},
    )
    assert result.periods == ["2023Q1", "2023Q2"]
    trends = result.trend_summary.set_index("rule")["trend"]
    assert trends["python → pandas"] == "emerging"
    assert trends["sql → excel"] == "declining"
    q2 = result.rule_trends[(result.rule_trends["rule"] == "python → pandas") & (result.rule_trends["period"] == "2023Q2")]
    assert q2["support"].iloc[0] == pytest.approx(40 / 100)


def test_analyse_temporal_requires_two_periods() -> None:
    data = _temporal_postings()
    with pytest.raises(MiningError):
        analyse_temporal(data, MiningConfig(min_support=0.05, min_lift=1.0, max_len=2),
                         TemporalConfig(min_transactions_per_period=10_000), labels={})


def test_analyse_temporal_reports_excluded_periods() -> None:
    data = pd.concat([_temporal_postings(), pd.DataFrame({"posted_at": pd.to_datetime(["2023-08-01"]),
                                                          "skills": [["python"]], "role": "x", "country": "y"})])
    result = analyse_temporal(data, MiningConfig(min_support=0.05, min_lift=1.0, max_len=2),
                              TemporalConfig(min_transactions_per_period=50), labels={})
    assert result.excluded_periods == {"2023Q3": 1}
    assert any("excluded" in m for m in result.messages)


def test_onehot_for_temporal_vocabulary_alignment() -> None:
    onehot = one_hot_encode([["a"]], vocabulary=["a", "b"])
    assert list(onehot.columns) == ["a", "b"]
