"""Baseline: individual skill frequency analysis.

The baseline answers "how often is each skill requested?" It is the
mandatory comparison point for association-rule mining, which answers
"which skills are requested *together* more than chance would predict?"
"""

from __future__ import annotations

from collections import Counter
from itertools import combinations
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from src.preprocessing.transaction_builder import one_hot_encode


def skill_frequency(skill_lists: Iterable[Sequence[str]]) -> pd.DataFrame:
    """Count postings per skill and the share of postings containing it.

    Returns columns ``skill``, ``postings``, ``share``, ``rank`` sorted by
    descending frequency (ties broken alphabetically for determinism).
    """
    lists = list(skill_lists)
    total = len(lists)
    counts = Counter(skill for skills in lists for skill in set(skills))
    frame = pd.DataFrame(counts.items(), columns=["skill", "postings"])
    if frame.empty:
        return frame.assign(share=pd.Series(dtype=float), rank=pd.Series(dtype=int))
    frame["share"] = frame["postings"] / total
    frame = frame.sort_values(["postings", "skill"], ascending=[False, True], ignore_index=True)
    frame["rank"] = np.arange(1, len(frame) + 1)
    return frame


def top_skills(frequency: pd.DataFrame, n: int) -> pd.DataFrame:
    """First ``n`` rows of a frequency table."""
    return frequency.head(n).reset_index(drop=True)


def segment_frequency(
    postings: pd.DataFrame, segment_column: str, skills: Sequence[str] | None = None, top_n: int = 15
) -> pd.DataFrame:
    """Share of postings containing each skill, per segment (e.g. role).

    Returns a long frame ``segment, skill, postings, segment_size, share``.
    When ``skills`` is omitted the overall top-``top_n`` skills are used.
    """
    if segment_column not in postings.columns:
        raise KeyError(f"Column '{segment_column}' not in postings")
    if skills is None:
        skills = skill_frequency(postings["skills"]).head(top_n)["skill"].tolist()

    exploded = postings[[segment_column, "skills"]].explode("skills")
    exploded = exploded[exploded["skills"].isin(skills)]
    counts = exploded.groupby([segment_column, "skills"]).size().rename("postings").reset_index()
    sizes = postings.groupby(segment_column).size().rename("segment_size").reset_index()
    out = counts.merge(sizes, on=segment_column)
    out["share"] = out["postings"] / out["segment_size"]
    return out.rename(columns={segment_column: "segment", "skills": "skill"})


def time_frequency(postings: pd.DataFrame, skills: Sequence[str], frequency: str = "M") -> pd.DataFrame:
    """Monthly (or other period) share of postings that contain each skill."""
    dated = postings.dropna(subset=["posted_at"])
    periods = dated["posted_at"].dt.to_period(frequency).astype(str)
    frame = dated.assign(period=periods)
    return segment_frequency(frame, "period", skills=skills).rename(columns={"segment": "period"})


def pair_cooccurrence(skill_lists: Sequence[Sequence[str]], skills: Sequence[str]) -> pd.DataFrame:
    """Square matrix of posting counts where both skills appear together."""
    matrix = one_hot_encode(skill_lists, vocabulary=list(skills)).to_numpy(dtype=np.int32)
    counts = matrix.T @ matrix
    return pd.DataFrame(counts, index=list(skills), columns=list(skills))


def baseline_vs_association(
    skill_lists: Sequence[Sequence[str]], frequency: pd.DataFrame, top_n: int = 15
) -> pd.DataFrame:
    """Contrast the naive baseline pairing with observed co-occurrence.

    A frequency-only planner would pair the most frequent skills. For every
    pair of the top-``top_n`` skills this returns observed joint support, the
    support *expected* if the two were independent (product of marginals),
    and lift. Pairs with lift ≈ 1 show that frequent ≠ associated.
    """
    top = frequency.head(top_n)
    total = len(skill_lists)
    co = pair_cooccurrence(skill_lists, top["skill"].tolist())
    share = top.set_index("skill")["share"]
    rows = []
    for a, b in combinations(top["skill"], 2):
        joint = co.at[a, b] / total
        expected = share[a] * share[b]
        rows.append(
            {
                "skill_a": a,
                "skill_b": b,
                "baseline_score": share[a] + share[b],
                "expected_support": expected,
                "observed_support": joint,
                "lift": joint / expected if expected else np.nan,
                "postings_together": int(co.at[a, b]),
            }
        )
    return pd.DataFrame(rows).sort_values("baseline_score", ascending=False, ignore_index=True)
