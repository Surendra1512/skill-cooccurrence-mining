"""Posting-level cleaning: missing values, identifiers and duplicates."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from config.settings import PreprocessingConfig

_CATEGORICAL_COLUMNS: tuple[str, ...] = ("role", "job_title", "job_location", "country", "company_id")


@dataclass
class CleaningStats:
    """Counts collected while cleaning, used in the preprocessing report."""

    original_records: int = 0
    missing_values: dict[str, int] = field(default_factory=dict)
    missing_job_id_removed: int = 0
    duplicate_ids_removed: int = 0
    duplicate_content_removed: int = 0
    postings_without_skills_removed: int = 0
    unparseable_dates: int = 0
    cleaned_records: int = 0


def handle_missing_values(frame: pd.DataFrame, config: PreprocessingConfig, stats: CleaningStats) -> pd.DataFrame:
    """Record and fill missing categorical values; drop rows lacking an id."""
    stats.missing_values = {
        column: int(frame[column].isna().sum()) for column in frame.columns if column != "raw_skills"
    }
    out = frame.copy()
    id_missing = out["job_id"].isna() | (out["job_id"].astype(str).str.strip() == "")
    stats.missing_job_id_removed = int(id_missing.sum())
    out = out.loc[~id_missing]

    for column in _CATEGORICAL_COLUMNS:
        if column in out.columns:
            out[column] = out[column].astype("object").where(out[column].notna(), config.unknown_label)
            out[column] = out[column].astype(str).str.strip().replace("", config.unknown_label)

    stats.unparseable_dates = int(out["posted_at"].isna().sum())
    return out


def remove_duplicate_ids(frame: pd.DataFrame, stats: CleaningStats) -> pd.DataFrame:
    """Keep the first occurrence of each ``job_id``."""
    mask = frame["job_id"].duplicated(keep="first")
    stats.duplicate_ids_removed = int(mask.sum())
    return frame.loc[~mask]


def remove_duplicate_content(
    frame: pd.DataFrame, config: PreprocessingConfig, stats: CleaningStats
) -> pd.DataFrame:
    """Drop re-posts: identical key fields *and* identical normalised skills.

    Must run after skill normalisation (expects a ``skills`` list column).
    """
    missing = [key for key in config.duplicate_keys if key not in frame.columns]
    if missing:
        raise KeyError(f"Duplicate key column(s) not in postings frame: {missing}")
    keys = list(config.duplicate_keys)
    signature = frame[keys].astype(str).copy()
    # Conservative: a row is only considered a re-post when every key field is
    # known. Rows with any unknown key (e.g. uploads without employer or title)
    # are kept, because identical skills + partial keys is not proof of a duplicate.
    key_values = frame[keys]
    uninformative = (key_values.isna() | key_values.astype(str).isin({config.unknown_label, "NaT", "nan", "None", "<NA>"})).any(axis=1)
    signature["_skills"] = frame["skills"].map(lambda s: "|".join(s))
    mask = signature.duplicated(keep="first") & ~uninformative
    stats.duplicate_content_removed = int(mask.sum())
    return frame.loc[~mask]


def drop_postings_without_skills(frame: pd.DataFrame, stats: CleaningStats) -> pd.DataFrame:
    """Remove postings whose normalised skill list is empty."""
    mask = frame["skills"].map(len) == 0
    stats.postings_without_skills_removed = int(mask.sum())
    return frame.loc[~mask]
