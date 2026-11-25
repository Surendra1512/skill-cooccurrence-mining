"""End-to-end preprocessing orchestration and persistence.

``raw postings → missing values → id de-duplication → skill normalisation →
empty-skill removal → content de-duplication → transactions + report``
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from config.settings import (
    PREPROCESSING_REPORT_PATH,
    PROCESSED_POSTINGS_PATH,
    SKILL_CATALOG_PATH,
    SKILL_TRACE_PATH,
    PreprocessingConfig,
)
from src.data_collection.dataset_loader import RawDataset
from src.preprocessing.cleaning import (
    CleaningStats,
    drop_postings_without_skills,
    handle_missing_values,
    remove_duplicate_content,
    remove_duplicate_ids,
)
from src.preprocessing.skill_normalization import (
    STATUS_INVALID,
    STATUS_MAPPED,
    SkillNormalizer,
    display_name,
    load_display_names,
)

logger = logging.getLogger(__name__)

PROCESSED_COLUMNS: tuple[str, ...] = (
    "job_id",
    "role",
    "job_title",
    "company_id",
    "job_location",
    "country",
    "posted_at",
    "skills",
)


@dataclass(frozen=True)
class PreprocessedDataset:
    """Clean postings (one transaction each) plus supporting artefacts."""

    postings: pd.DataFrame
    skill_catalog: pd.DataFrame
    trace: pd.DataFrame
    report: dict[str, Any]


def build_skill_catalog(
    postings: pd.DataFrame, trace: pd.DataFrame, raw_skill_types: dict[str, str]
) -> pd.DataFrame:
    """Canonical skill table with label, category and posting counts."""
    counts = Counter(skill for skills in postings["skills"] for skill in skills)
    total = len(postings)
    labels = load_display_names()

    category: dict[str, str] = {}
    variants: dict[str, list[str]] = {}
    for row in trace.loc[trace["canonical"].notna()].itertuples(index=False):
        variants.setdefault(row.canonical, []).append(row.raw_skill)
        raw_type = raw_skill_types.get(row.raw_skill)
        if raw_type and row.canonical not in category:
            category[row.canonical] = raw_type

    rows = [
        {
            "skill": skill,
            "label": display_name(skill, labels),
            "category": category.get(skill, "uncategorised"),
            "postings": count,
            "share": count / total if total else 0.0,
            "raw_variants": ", ".join(sorted(set(variants.get(skill, [skill])))),
        }
        for skill, count in counts.items()
    ]
    columns = ["skill", "label", "category", "postings", "share", "raw_variants"]
    return pd.DataFrame(rows, columns=columns).sort_values("postings", ascending=False, ignore_index=True)


def run_preprocessing(
    raw: RawDataset,
    config: PreprocessingConfig | None = None,
    normalizer: SkillNormalizer | None = None,
) -> PreprocessedDataset:
    """Run the full cleaning/normalisation pipeline on a raw dataset."""
    config = config or PreprocessingConfig()
    normalizer = normalizer or SkillNormalizer.from_files(config)
    stats = CleaningStats(original_records=len(raw.postings))

    frame = handle_missing_values(raw.postings, config, stats)
    frame = remove_duplicate_ids(frame, stats)
    frame = frame.assign(skills=frame["raw_skills"].map(normalizer.normalize_list))
    if config.drop_postings_without_skills:
        frame = drop_postings_without_skills(frame, stats)
    frame = remove_duplicate_content(frame, config, stats)

    postings = frame[list(PROCESSED_COLUMNS)].reset_index(drop=True)
    stats.cleaned_records = len(postings)
    trace = normalizer.trace()
    catalog = build_skill_catalog(postings, trace, raw.skill_types)
    report = _build_report(raw, postings, trace, catalog, stats)
    logger.info("Preprocessing complete: %s transactions", f"{len(postings):,}")
    return PreprocessedDataset(postings=postings, skill_catalog=catalog, trace=trace, report=report)


def _build_report(
    raw: RawDataset,
    postings: pd.DataFrame,
    trace: pd.DataFrame,
    catalog: pd.DataFrame,
    stats: CleaningStats,
) -> dict[str, Any]:
    sizes = postings["skills"].map(len)
    dates = postings["posted_at"].dropna()
    raw_distinct = int(trace["raw_skill"].nunique())
    return {
        "source": raw.source_key,
        "original_records": stats.original_records,
        "cleaned_records": stats.cleaned_records,
        "duplicate_records_removed": stats.duplicate_ids_removed + stats.duplicate_content_removed,
        "duplicate_ids_removed": stats.duplicate_ids_removed,
        "duplicate_content_removed": stats.duplicate_content_removed,
        "missing_job_id_removed": stats.missing_job_id_removed,
        "postings_without_skills_removed": stats.postings_without_skills_removed,
        "missing_values_by_column": stats.missing_values,
        "missing_values_handling": "Categorical fields filled with 'Unknown'; postings without "
        "a job id or without any valid skill removed; unparseable dates kept but excluded "
        "from temporal analysis.",
        "unparseable_dates": stats.unparseable_dates,
        "distinct_raw_skill_strings": raw_distinct,
        "synonym_variants_merged": int((trace["status"] == STATUS_MAPPED).sum()),
        "invalid_skill_strings_removed": int((trace["status"] == STATUS_INVALID).sum()),
        "unique_skills": int(len(catalog)),
        "total_transactions": int(len(postings)),
        "total_skill_mentions": int(sizes.sum()),
        "avg_skills_per_transaction": round(float(sizes.mean()), 3) if len(sizes) else 0.0,
        "median_skills_per_transaction": float(sizes.median()) if len(sizes) else 0.0,
        "single_skill_transactions": int((sizes == 1).sum()),
        "date_min": dates.min().isoformat() if len(dates) else None,
        "date_max": dates.max().isoformat() if len(dates) else None,
        "top_skills": catalog.head(20)[["label", "postings", "share"]]
        .assign(share=lambda d: d["share"].round(4))
        .to_dict("records"),
    }


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #
def save_preprocessed(
    dataset: PreprocessedDataset,
    postings_path: Path = PROCESSED_POSTINGS_PATH,
    catalog_path: Path = SKILL_CATALOG_PATH,
    trace_path: Path = SKILL_TRACE_PATH,
    report_path: Path = PREPROCESSING_REPORT_PATH,
) -> None:
    """Write processed artefacts to ``data/processed`` and the report."""
    for path in (postings_path, catalog_path, trace_path, report_path):
        path.parent.mkdir(parents=True, exist_ok=True)
    dataset.postings.to_parquet(postings_path, index=False)
    dataset.skill_catalog.to_csv(catalog_path, index=False)
    dataset.trace.to_csv(trace_path, index=False)
    report_path.write_text(json.dumps(dataset.report, indent=2, default=str), encoding="utf-8")


def load_preprocessed(
    postings_path: Path = PROCESSED_POSTINGS_PATH,
    catalog_path: Path = SKILL_CATALOG_PATH,
    trace_path: Path = SKILL_TRACE_PATH,
    report_path: Path = PREPROCESSING_REPORT_PATH,
) -> PreprocessedDataset:
    """Load previously saved processed artefacts."""
    missing = [p for p in (postings_path, catalog_path, trace_path, report_path) if not p.exists()]
    if missing:
        raise FileNotFoundError(
            "Processed data not found: " + ", ".join(str(p) for p in missing)
            + ". Run `python -m scripts.build_dataset`."
        )
    postings = pd.read_parquet(postings_path)
    postings["skills"] = postings["skills"].map(list)
    return PreprocessedDataset(
        postings=postings,
        skill_catalog=pd.read_csv(catalog_path),
        trace=pd.read_csv(trace_path),
        report=json.loads(report_path.read_text(encoding="utf-8")),
    )
