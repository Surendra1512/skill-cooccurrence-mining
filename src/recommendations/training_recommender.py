"""Evidence-backed training-programme recommendations.

Every recommendation is derived from mined association rules whose
antecedent the learner already holds and whose consequent they lack. Nothing
is suggested without a supporting rule; when no rule applies, the result says
so instead of guessing. Recommendations describe employer demand in the
analysed postings — they are not predictions of employment outcomes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from config.settings import PREREQUISITES_PATH, RecommenderConfig
from src.mining.association_rules import itemset_label

CATEGORY_MODULE_NAMES: dict[str, str] = {
    "programming": "Programming languages",
    "libraries": "Libraries & frameworks",
    "analyst_tools": "Analytics & BI tools",
    "cloud": "Cloud platforms",
    "databases": "Databases",
    "webframeworks": "Web frameworks",
    "os": "Operating systems",
    "other": "DevOps & engineering tools",
    "async": "Project & collaboration tools",
    "sync": "Communication tools",
    "uncategorised": "Other skills",
}


def load_prerequisites(path: Path = PREREQUISITES_PATH) -> dict[str, list[str]]:
    """Curated prerequisite map (domain knowledge, clearly not mined)."""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return {k: list(v) for k, v in json.load(handle).get("prerequisites", {}).items()}


@dataclass(frozen=True)
class Recommendation:
    skill: str
    label: str
    category: str
    score: float
    confidence: float
    lift: float
    support: float
    support_count: int
    antecedent_count: int
    supporting_rules: int
    best_rule: str
    explanation: str


@dataclass(frozen=True)
class TrainingProgramme:
    skills: list[str]
    labels: list[str]
    postings_with_combination: int
    share_of_all_postings: float
    share_of_learner_postings: float | None
    modules: list[dict[str, object]]
    prerequisites: list[dict[str, str]]
    target_roles: pd.DataFrame


@dataclass(frozen=True)
class RecommendationResult:
    selected: list[str]
    recommendations: list[Recommendation]
    evidence: pd.DataFrame
    programme: TrainingProgramme | None
    messages: list[str] = field(default_factory=list)

    def as_frame(self) -> pd.DataFrame:
        return pd.DataFrame([r.__dict__ for r in self.recommendations])


def applicable_rules(ranked_rules: pd.DataFrame, selected: Iterable[str]) -> pd.DataFrame:
    """Rules whose antecedent ⊆ selected skills and consequent adds new skills."""
    held = frozenset(selected)
    if ranked_rules.empty or not held:
        return ranked_rules.iloc[0:0]
    mask = [a <= held and not (c & held) for a, c in zip(ranked_rules["antecedents"], ranked_rules["consequents"])]
    return ranked_rules.loc[mask]


def explain_rule(row: pd.Series, labels: dict[str, str]) -> str:
    """One-sentence plain-language explanation of a rule's evidence."""
    antecedent = itemset_label(row["antecedents"], labels, " and ")
    consequent = itemset_label(row["consequents"], labels, " and ")
    n_transactions = row["support_count"] / row["support"] if row["support"] else 0.0
    antecedent_count = int(round(row["antecedent_support"] * n_transactions))
    return (
        f"Of {antecedent_count:,} postings requiring {antecedent}, {row['confidence']:.0%} also require "
        f"{consequent} — {row['lift']:.2f}× the rate in all postings ({row['consequent_support']:.1%})."
    )


def recommend(
    selected: Iterable[str],
    ranked_rules: pd.DataFrame,
    postings: pd.DataFrame,
    catalog: pd.DataFrame,
    config: RecommenderConfig | None = None,
    prerequisites: dict[str, list[str]] | None = None,
) -> RecommendationResult:
    """Recommend complementary skills and a combined training programme."""
    config = config or RecommenderConfig()
    held = sorted(set(selected))
    labels = dict(zip(catalog["skill"], catalog["label"]))
    categories = dict(zip(catalog["skill"], catalog["category"]))
    prerequisites = prerequisites if prerequisites is not None else load_prerequisites()
    messages: list[str] = []

    if not held:
        return RecommendationResult(held, [], ranked_rules.iloc[0:0], None, ["Select at least one skill."])

    rules = applicable_rules(ranked_rules, held)
    if rules.empty:
        messages.append(
            "No mined rule starts from the selected skill set at the current thresholds, so no "
            "evidence-backed recommendation can be made. Lower the minimum support or confidence, "
            "or select fewer / more common skills."
        )
        return RecommendationResult(held, [], rules, None, messages)

    n_total = len(postings)
    rule_counts: dict[str, int] = {}
    for consequents in rules["consequents"]:
        for skill in consequents:
            rule_counts[skill] = rule_counts.get(skill, 0) + 1

    # A skill's metrics come from its best rule whose consequent is exactly that
    # skill; multi-skill consequents are used only when no such rule exists, so
    # a combination's lift is never attributed to a single skill.
    single = rules[rules["consequent_len"] == 1]
    multi = rules[rules["consequent_len"] > 1]
    candidates: dict[str, Recommendation] = {}
    for subset in (single, multi):
        for _, row in subset.iterrows():  # each subset is already sorted by score
            for skill in row["consequents"]:
                if skill in candidates:
                    continue
                candidates[skill] = Recommendation(
                    skill=skill,
                    label=labels.get(skill, skill),
                    category=categories.get(skill, "uncategorised"),
                    score=float(row["score"]),
                    confidence=float(row["confidence"]),
                    lift=float(row["lift"]),
                    support=float(row["support"]),
                    support_count=int(row["support_count"]),
                    antecedent_count=int(round(row["antecedent_support"] * n_total)),
                    supporting_rules=rule_counts[skill],
                    best_rule=f"{itemset_label(row['antecedents'], labels)} → {itemset_label(row['consequents'], labels)}",
                    explanation=explain_rule(row, labels),
                )
    ordered = sorted(candidates.values(), key=lambda r: r.score, reverse=True)
    recs = ordered[: config.max_recommendations]

    evidence = rules.assign(
        rule=[f"{itemset_label(a, labels)} → {itemset_label(c, labels)}" for a, c in zip(rules["antecedents"], rules["consequents"])]
    )
    programme = build_programme(held, recs, postings, labels, categories, prerequisites, config, messages)
    return RecommendationResult(held, recs, evidence, programme, messages)


def _contains_all(skill_lists: pd.Series, skills: Iterable[str]) -> np.ndarray:
    wanted = frozenset(skills)
    return np.fromiter((wanted <= set(s) for s in skill_lists), dtype=bool, count=len(skill_lists))


def build_programme(
    held: list[str],
    recs: list[Recommendation],
    postings: pd.DataFrame,
    labels: dict[str, str],
    categories: dict[str, str],
    prerequisites: dict[str, list[str]],
    config: RecommenderConfig,
    messages: list[str],
) -> TrainingProgramme | None:
    """Greedily add top recommendations while the combination stays in demand."""
    learner_mask = _contains_all(postings["skills"], held)
    combo = list(held)
    combo_mask = learner_mask
    for rec in recs:
        if len(combo) - len(held) >= config.programme_size:
            break
        candidate_mask = combo_mask & _contains_all(postings["skills"], [rec.skill])
        if candidate_mask.sum() >= config.min_programme_postings:
            combo.append(rec.skill)
            combo_mask = candidate_mask

    added = [s for s in combo if s not in held]
    if not added:
        messages.append(
            f"No combined programme reaches the minimum of {config.min_programme_postings} postings "
            "containing the full skill combination."
        )
        return None

    modules: dict[str, list[str]] = {}
    for skill in added:
        modules.setdefault(CATEGORY_MODULE_NAMES.get(categories.get(skill, "uncategorised"), "Other skills"), []).append(
            labels.get(skill, skill)
        )
    prereq_rows = [
        {
            "skill": labels.get(skill, skill),
            "prerequisite": labels.get(pre, pre),
            "status": "already held" if pre in held else ("included in programme" if pre in combo else "learn first"),
        }
        for skill in added
        for pre in prerequisites.get(skill, [])
    ]

    roles = postings.loc[combo_mask, "role"].value_counts()
    overall_roles = postings["role"].value_counts(normalize=True)
    role_frame = (
        pd.DataFrame({"role": roles.index, "postings": roles.values})
        .assign(share=lambda d: d["postings"] / d["postings"].sum())
        .assign(lift_vs_overall=lambda d: d["share"] / d["role"].map(overall_roles))
        .head(config.top_roles)
    )
    total = len(postings)
    learner_total = int(learner_mask.sum())
    return TrainingProgramme(
        skills=combo,
        labels=[labels.get(s, s) for s in combo],
        postings_with_combination=int(combo_mask.sum()),
        share_of_all_postings=float(combo_mask.sum() / total) if total else 0.0,
        share_of_learner_postings=float(combo_mask.sum() / learner_total) if learner_total else None,
        modules=[{"module": name, "skills": skills} for name, skills in modules.items()],
        prerequisites=prereq_rows,
        target_roles=role_frame,
    )


def role_skill_gap(held: Iterable[str], role: str, postings: pd.DataFrame, catalog: pd.DataFrame, top_n: int = 10) -> pd.DataFrame:
    """Skills most requested in ``role`` postings that the learner lacks.

    Returns the share of role postings requiring each missing skill and how
    much more common it is in that role than across all postings.
    """
    held_set = set(held)
    role_postings = postings.loc[postings["role"] == role, "skills"]
    if role_postings.empty:
        return pd.DataFrame(columns=["skill", "label", "share_in_role", "share_overall", "role_lift", "postings"])
    counts = pd.Series([s for skills in role_postings for s in skills]).value_counts()
    overall = pd.Series([s for skills in postings["skills"] for s in skills]).value_counts() / len(postings)
    labels = dict(zip(catalog["skill"], catalog["label"]))
    frame = pd.DataFrame({"skill": counts.index, "postings": counts.values})
    frame = frame[~frame["skill"].isin(held_set)].head(top_n)
    frame["share_in_role"] = frame["postings"] / len(role_postings)
    frame["share_overall"] = frame["skill"].map(overall)
    frame["role_lift"] = frame["share_in_role"] / frame["share_overall"]
    frame["label"] = frame["skill"].map(lambda s: labels.get(s, s))
    return frame[["skill", "label", "share_in_role", "share_overall", "role_lift", "postings"]].reset_index(drop=True)
