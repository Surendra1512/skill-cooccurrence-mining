"""Support / confidence / lift validated against hand-computed values."""

from __future__ import annotations

import random

import pandas as pd
import pytest

from src.mining.association_rules import compute_rule_metrics, evaluate_rules_on, generate_rules
from src.mining.fpgrowth_miner import mine_fpgrowth
from src.preprocessing.transaction_builder import one_hot_encode

# Hand-computed for the fixture (N = 5):
#   python→sql:        support 3/5, confidence 3/4, lift (3/4)/(4/5) = 0.9375
#   python+sql→excel:  support 2/5, confidence 2/3, lift (2/3)/(4/5) = 0.8333…
#   tableau→python:    support 1/5, confidence 1/1, lift 1/(4/5)     = 1.25
HAND = [
    (("python",), ("sql",), 0.6, 0.75, 0.9375),
    (("python", "sql"), ("excel",), 0.4, 2 / 3, (2 / 3) / 0.8),
    (("tableau",), ("python",), 0.2, 1.0, 1.25),
    (("python",), ("sql", "excel"), 0.4, 0.5, 0.5 / 0.6),
]


@pytest.mark.parametrize(("antecedent", "consequent", "support", "confidence", "lift"), HAND)
def test_compute_rule_metrics_matches_hand_values(transactions, antecedent, consequent, support, confidence, lift) -> None:
    metrics = compute_rule_metrics(transactions, antecedent, consequent)
    assert metrics.support == pytest.approx(support)
    assert metrics.confidence == pytest.approx(confidence)
    assert metrics.lift == pytest.approx(lift)
    assert metrics.n_transactions == 5


@pytest.mark.parametrize(("antecedent", "consequent", "support", "confidence", "lift"), HAND)
def test_library_rules_match_hand_values(onehot, antecedent, consequent, support, confidence, lift) -> None:
    rules = generate_rules(mine_fpgrowth(onehot, min_support=0.2, max_len=4), min_confidence=0.0)
    row = rules[(rules["antecedents"] == frozenset(antecedent)) & (rules["consequents"] == frozenset(consequent))]
    assert len(row) == 1
    assert row["support"].iloc[0] == pytest.approx(support)
    assert row["confidence"].iloc[0] == pytest.approx(confidence)
    assert row["lift"].iloc[0] == pytest.approx(lift)
    assert row["support_count"].iloc[0] == round(support * 5)


def test_metric_identities(onehot) -> None:
    rules = generate_rules(mine_fpgrowth(onehot, 0.2, 4), 0.0)
    assert (rules["confidence"] - rules["support"] / rules["antecedent_support"]).abs().max() < 1e-12
    assert (rules["lift"] - rules["confidence"] / rules["consequent_support"]).abs().max() < 1e-12


def test_metrics_validation_errors(transactions) -> None:
    with pytest.raises(ValueError):
        compute_rule_metrics(transactions, [], ["sql"])
    with pytest.raises(ValueError):
        compute_rule_metrics(transactions, ["sql"], ["sql"])


def test_library_agrees_with_brute_force_on_random_data() -> None:
    rng = random.Random(7)
    items = list("abcdefg")
    transactions = [rng.sample(items, rng.randint(1, 5)) for _ in range(300)]
    onehot = one_hot_encode(transactions)
    rules = generate_rules(mine_fpgrowth(onehot, 0.05, 3), 0.0)
    assert not rules.empty
    for row in rules.sample(min(40, len(rules)), random_state=1).itertuples():
        reference = compute_rule_metrics(transactions, row.antecedents, row.consequents)
        assert row.support == pytest.approx(reference.support)
        assert row.confidence == pytest.approx(reference.confidence)
        assert row.lift == pytest.approx(reference.lift)


def test_evaluate_rules_on_subset(transactions) -> None:
    rules = pd.DataFrame({"antecedents": [frozenset({"python"}), frozenset({"tableau"})],
                          "consequents": [frozenset({"sql"}), frozenset({"missing"})]})
    subset = transactions[:2]  # {python,sql,excel}, {python,sql}
    result = evaluate_rules_on(one_hot_encode(subset), rules)
    assert result.loc[0, "support"] == pytest.approx(1.0)
    assert result.loc[0, "confidence"] == pytest.approx(1.0)
    assert result.loc[0, "lift"] == pytest.approx(1.0)
    assert result.loc[1, "support"] == 0.0  # unseen skills count as absent
    assert result.loc[1, "lift"] == 0.0
