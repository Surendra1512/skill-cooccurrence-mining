"""Central configuration for the Skill Co-Occurrence Mining project.

All thresholds, paths, ranking weights and dataset source definitions live
here so analytics never depend on hard-coded values scattered in modules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parent.parent
DATA_DIR: Final[Path] = PROJECT_ROOT / "data"
RAW_DIR: Final[Path] = DATA_DIR / "raw"
PROCESSED_DIR: Final[Path] = DATA_DIR / "processed"
EXTERNAL_DIR: Final[Path] = DATA_DIR / "external"
OUTPUTS_DIR: Final[Path] = PROJECT_ROOT / "outputs"
REPORTS_DIR: Final[Path] = OUTPUTS_DIR / "reports"
RESULTS_DIR: Final[Path] = OUTPUTS_DIR / "results"
CHARTS_DIR: Final[Path] = OUTPUTS_DIR / "charts"

SYNONYMS_PATH: Final[Path] = EXTERNAL_DIR / "skill_synonyms.json"
DISPLAY_NAMES_PATH: Final[Path] = EXTERNAL_DIR / "skill_display_names.json"
PREREQUISITES_PATH: Final[Path] = EXTERNAL_DIR / "skill_prerequisites.json"

PROCESSED_POSTINGS_PATH: Final[Path] = PROCESSED_DIR / "postings.parquet"
SKILL_TRACE_PATH: Final[Path] = PROCESSED_DIR / "skill_normalization_trace.csv"
SKILL_CATALOG_PATH: Final[Path] = PROCESSED_DIR / "skill_catalog.csv"
PREPROCESSING_REPORT_PATH: Final[Path] = REPORTS_DIR / "preprocessing_report.json"


# --------------------------------------------------------------------------- #
# Dataset source definition
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RemoteFile:
    """A single downloadable raw file with an integrity checksum."""

    name: str
    url: str
    sha256: str
    extract_member: str | None = None  # file to extract when ``name`` is a zip


@dataclass(frozen=True)
class DatasetSource:
    """Metadata describing a public dataset used by the pipeline."""

    key: str
    title: str
    publisher: str
    original_url: str
    mirror_url: str
    licence: str
    description: str
    files: tuple[RemoteFile, ...]


_MIRROR_RAW = (
    "https://raw.githubusercontent.com/subhankar-das18/"
    "SQL-Job-Market-Analysis/main/data/csv_files"
)

DATA_JOBS_2023: Final[DatasetSource] = DatasetSource(
    key="data_jobs_2023",
    title="Data Jobs 2023 (job postings with extracted skills)",
    publisher="Luke Barousse (collected via job-board scraping, skills NLP-extracted)",
    original_url="https://huggingface.co/datasets/lukebarousse/data_jobs",
    mirror_url="https://github.com/subhankar-das18/SQL-Job-Market-Analysis",
    licence=(
        "Apache-2.0 (as declared on the original Hugging Face dataset card). "
        "The relational CSV form is distributed with Luke Barousse's SQL course "
        "and mirrored publicly on GitHub; the mirror does not declare a separate licence."
    ),
    description=(
        "787,686 real job postings for data and technology roles posted between "
        "31 Dec 2022 and 31 Dec 2023 across 160 countries, with 259 canonical skill "
        "tokens extracted from the posting text."
    ),
    files=(
        RemoteFile(
            name="job_postings_fact.zip",
            url=f"{_MIRROR_RAW}/job_postings_fact.zip",
            sha256="661b106b5edcd22fd2101cc413e2e277a86a920957af80418afd6957265e4350",
            extract_member="job_postings_fact.csv",
        ),
        RemoteFile(
            name="skills_dim.csv",
            url=f"{_MIRROR_RAW}/skills_dim.csv",
            sha256="71e1064afdb28c52cacf9fd83b5f9e714af340ed163f04d8615d5c83799b3121",
        ),
        RemoteFile(
            name="skills_job_dim.csv",
            url=f"{_MIRROR_RAW}/skills_job_dim.csv",
            sha256="7ddc6cb8f36b3206de47ba1771ebf0647b72bd0ee3e06471d6fbf3024fb82f85",
        ),
    ),
)

EXTRACTED_POSTINGS_SHA256: Final[str] = (
    "ac6b4c9a864a8c3bcde1ee9054b7347cb3e9c33a40772067b508ab3dad64845c"
)


# --------------------------------------------------------------------------- #
# Preprocessing
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PreprocessingConfig:
    """Rules applied while cleaning postings and building transactions."""

    # A posting is a duplicate when all of these fields AND its skill set match.
    duplicate_keys: tuple[str, ...] = (
        "company_id",
        "job_title",
        "job_location",
        "posted_at",
    )
    min_skill_length: int = 1
    max_skill_length: int = 60
    drop_postings_without_skills: bool = True
    unknown_label: str = "Unknown"


# --------------------------------------------------------------------------- #
# Mining
# --------------------------------------------------------------------------- #
ALGORITHMS: Final[tuple[str, ...]] = ("FP-Growth", "Apriori")


@dataclass(frozen=True)
class MiningConfig:
    """User-tunable association-mining thresholds."""

    algorithm: str = "FP-Growth"
    min_support: float = 0.01
    min_confidence: float = 0.30
    min_lift: float = 1.20
    max_len: int = 3

    def __post_init__(self) -> None:
        if self.algorithm not in ALGORITHMS:
            raise ValueError(f"Unknown algorithm '{self.algorithm}'. Use one of {ALGORITHMS}.")
        if not 0.0 < self.min_support <= 1.0:
            raise ValueError("min_support must be in (0, 1].")
        if not 0.0 <= self.min_confidence <= 1.0:
            raise ValueError("min_confidence must be in [0, 1].")
        if self.min_lift < 0.0:
            raise ValueError("min_lift must be non-negative.")
        if self.max_len < 2:
            raise ValueError("max_len must be at least 2 to form a rule.")


@dataclass(frozen=True)
class SliderBounds:
    """UI bounds for the mining configuration controls."""

    support: tuple[float, float, float] = (0.002, 0.20, 0.001)
    confidence: tuple[float, float, float] = (0.05, 0.95, 0.05)
    lift: tuple[float, float, float] = (0.0, 10.0, 0.1)
    max_len: tuple[int, int] = (2, 5)


@dataclass(frozen=True)
class RankingWeights:
    """Weights for the composite rule score (normalised to sum to 1)."""

    lift: float = 0.4
    confidence: float = 0.4
    support: float = 0.2

    def normalised(self) -> tuple[float, float, float]:
        total = self.lift + self.confidence + self.support
        if total <= 0:
            raise ValueError("At least one ranking weight must be positive.")
        return self.lift / total, self.confidence / total, self.support / total


# --------------------------------------------------------------------------- #
# Temporal analysis
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class TemporalConfig:
    """Controls how postings are split into periods."""

    frequency: str = "Q"  # pandas period alias: "Q" quarterly or "M" monthly
    min_transactions_per_period: int = 5_000
    top_k_rules: int = 25
    trend_min_relative_change: float = 0.15  # 15 % change in support → trend


# --------------------------------------------------------------------------- #
# Recommendation
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RecommenderConfig:
    """Controls for the training-programme recommender."""

    max_recommendations: int = 8
    programme_size: int = 3  # complementary skills added to the learner's skills
    min_programme_postings: int = 30  # combination must appear in ≥ N postings
    top_roles: int = 5


@dataclass(frozen=True)
class AppSettings:
    """Aggregate settings object handed to the application."""

    preprocessing: PreprocessingConfig = field(default_factory=PreprocessingConfig)
    mining: MiningConfig = field(default_factory=MiningConfig)
    sliders: SliderBounds = field(default_factory=SliderBounds)
    ranking: RankingWeights = field(default_factory=RankingWeights)
    temporal: TemporalConfig = field(default_factory=TemporalConfig)
    recommender: RecommenderConfig = field(default_factory=RecommenderConfig)
    random_seed: int = 42


SETTINGS: Final[AppSettings] = AppSettings()
