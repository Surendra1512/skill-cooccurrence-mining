"""Training-programme recommender."""

from __future__ import annotations

import pytest

from config.settings import MiningConfig, RecommenderConfig
from src.mining.engine import run_mining
from src.preprocessing.transaction_builder import one_hot_encode
from src.recommendations.training_recommender import applicable_rules, recommend, role_skill_gap

CONFIG = RecommenderConfig(max_recommendations=5, programme_size=2, min_programme_postings=1, top_roles=3)


def _ranked(postings):
    onehot = one_hot_encode(postings["skills"])
    return run_mining(onehot, MiningConfig("FP-Growth", 0.2, 0.0, 0.0, 4)).ranked


def test_applicable_rules_subset_logic(postings) -> None:
    rules = applicable_rules(_ranked(postings), ["python"])
    assert len(rules) > 0
    assert all(a <= {"python"} and "python" not in c for a, c in zip(rules["antecedents"], rules["consequents"]))


def test_recommendations_are_backed_by_rules(postings, catalog) -> None:
    ranked = _ranked(postings)
    result = recommend(["tableau"], ranked, postings, catalog, CONFIG, prerequisites={})
    skills = {r.skill for r in result.recommendations}
    assert skills == {"python", "sql", "excel"}  # tableau→X has confidence 1 for all three
    for rec in result.recommendations:
        assert rec.confidence == pytest.approx(1.0)
        assert rec.lift == pytest.approx(1.25)
        assert rec.support_count == 1
        assert "tableau" not in rec.skill
        assert "1 postings requiring Tableau" in rec.explanation
    assert not result.evidence.empty


def test_no_recommendation_without_evidence(postings, catalog) -> None:
    ranked = _ranked(postings).iloc[0:0]
    result = recommend(["python"], ranked, postings, catalog, CONFIG, prerequisites={})
    assert result.recommendations == []
    assert result.programme is None
    assert any("No mined rule" in m for m in result.messages)


def test_empty_selection(postings, catalog) -> None:
    result = recommend([], _ranked(postings), postings, catalog, CONFIG, prerequisites={})
    assert result.recommendations == [] and result.messages


def test_programme_combination_counts_and_roles(postings, catalog) -> None:
    result = recommend(["tableau"], _ranked(postings), postings, catalog, CONFIG, prerequisites={"excel": ["tableau"]})
    programme = result.programme
    assert programme is not None
    assert programme.skills[0] == "tableau" and len(programme.skills) == 3
    assert programme.postings_with_combination == 1  # only posting 5 has tableau
    assert programme.share_of_learner_postings == pytest.approx(1.0)
    assert programme.target_roles["role"].tolist() == ["Data Scientist"]
    if "excel" in programme.skills:
        assert programme.prerequisites[0]["status"] == "already held"


def test_programme_respects_minimum_postings(postings, catalog) -> None:
    strict = RecommenderConfig(max_recommendations=5, programme_size=2, min_programme_postings=10, top_roles=3)
    result = recommend(["tableau"], _ranked(postings), postings, catalog, strict, prerequisites={})
    assert result.programme is None
    assert any("minimum" in m for m in result.messages)


def test_role_skill_gap(postings, catalog) -> None:
    gap = role_skill_gap(["python"], "Data Scientist", postings, catalog)
    assert "python" not in set(gap["skill"])
    tableau = gap.set_index("skill").loc["tableau"]
    assert tableau["share_in_role"] == pytest.approx(0.5)
    assert tableau["share_overall"] == pytest.approx(0.2)
    assert tableau["role_lift"] == pytest.approx(2.5)


def test_role_skill_gap_unknown_role(postings, catalog) -> None:
    assert role_skill_gap(["python"], "Astronaut", postings, catalog).empty
