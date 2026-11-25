"""Dataset acquisition and loading.

Responsibilities
----------------
* Download the public raw files into ``data/raw/`` with SHA-256 verification
  (originals are never modified).
* Load the relational tables and assemble a *standard postings frame* — one
  row per posting with its list of raw (un-normalised) skill strings.
* Load user-supplied CSV files (e.g. a cooperative's own vacancy records)
  into the same standard schema so the full pipeline can run on them.

Standard postings schema
------------------------
``job_id`` (str), ``role`` (str), ``job_title`` (str), ``company_id`` (str),
``job_location`` (str), ``country`` (str), ``posted_at`` (datetime64),
``raw_skills`` (list[str]).
"""

from __future__ import annotations

import ast
import hashlib
import logging
import shutil
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Iterable

import pandas as pd

from config.settings import (
    DATA_JOBS_2023,
    EXTRACTED_POSTINGS_SHA256,
    RAW_DIR,
    DatasetSource,
    RemoteFile,
)

logger = logging.getLogger(__name__)

STANDARD_COLUMNS: tuple[str, ...] = (
    "job_id",
    "role",
    "job_title",
    "company_id",
    "job_location",
    "country",
    "posted_at",
    "raw_skills",
)

_CHUNK = 1 << 20


class DatasetError(RuntimeError):
    """Raised when a dataset cannot be downloaded, verified or parsed."""


# --------------------------------------------------------------------------- #
# Download & verification
# --------------------------------------------------------------------------- #
def sha256_of(path: Path) -> str:
    """Return the hex SHA-256 digest of ``path``."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def _download(remote: RemoteFile, target: Path, timeout: int) -> None:
    tmp = target.with_suffix(target.suffix + ".part")
    logger.info("Downloading %s", remote.url)
    try:
        with urllib.request.urlopen(remote.url, timeout=timeout) as response, tmp.open("wb") as out:
            shutil.copyfileobj(response, out, _CHUNK)
    except OSError as exc:  # URLError is a subclass of OSError
        tmp.unlink(missing_ok=True)
        raise DatasetError(f"Could not download {remote.url}: {exc}") from exc
    tmp.replace(target)


def ensure_raw_files(
    source: DatasetSource = DATA_JOBS_2023,
    raw_dir: Path = RAW_DIR,
    timeout: int = 300,
) -> dict[str, Path]:
    """Download (if missing) and verify every raw file of ``source``.

    Returns a mapping ``logical file name -> local path`` where zip archives
    are resolved to their extracted member.
    """
    target_dir = raw_dir / source.key
    target_dir.mkdir(parents=True, exist_ok=True)
    resolved: dict[str, Path] = {}

    for remote in source.files:
        path = target_dir / remote.name
        if not path.exists():
            _download(remote, path, timeout)
        actual = sha256_of(path)
        if actual != remote.sha256:
            raise DatasetError(
                f"Checksum mismatch for {path.name}: expected {remote.sha256}, got {actual}. "
                "Delete the file and download again."
            )

        if remote.extract_member:
            member_path = target_dir / remote.extract_member
            if not member_path.exists():
                with zipfile.ZipFile(path) as archive:
                    if remote.extract_member not in archive.namelist():
                        raise DatasetError(f"{remote.extract_member} not found in {path.name}")
                    archive.extract(remote.extract_member, target_dir)
            if sha256_of(member_path) != EXTRACTED_POSTINGS_SHA256:
                raise DatasetError(f"Checksum mismatch for extracted {member_path.name}.")
            resolved[remote.extract_member] = member_path
        else:
            resolved[remote.name] = path

    return resolved


def raw_files_present(source: DatasetSource = DATA_JOBS_2023, raw_dir: Path = RAW_DIR) -> bool:
    """True when all raw files of ``source`` exist locally (unverified)."""
    target_dir = raw_dir / source.key
    return all((target_dir / f.name).exists() for f in source.files)


# --------------------------------------------------------------------------- #
# Loading the reference dataset
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RawDataset:
    """Standard postings frame plus skill-category metadata."""

    postings: pd.DataFrame
    skill_types: dict[str, str]
    source_key: str


def load_data_jobs(files: dict[str, Path]) -> RawDataset:
    """Assemble the Data Jobs 2023 relational tables into the standard schema."""
    try:
        postings = pd.read_csv(
            files["job_postings_fact.csv"],
            usecols=[
                "job_id",
                "company_id",
                "job_title_short",
                "job_title",
                "job_location",
                "job_country",
                "job_posted_date",
            ],
        )
        skills = pd.read_csv(files["skills_dim.csv"])
        links = pd.read_csv(files["skills_job_dim.csv"])
    except (KeyError, FileNotFoundError, pd.errors.ParserError, ValueError) as exc:
        raise DatasetError(f"Failed to read raw tables: {exc}") from exc

    required = {"skill_id", "skills", "type"}
    if not required.issubset(skills.columns):
        raise DatasetError(f"skills_dim.csv must contain {sorted(required)}")

    joined = links.merge(skills, on="skill_id", how="left", validate="many_to_one")
    unknown_ids = int(joined["skills"].isna().sum())
    if unknown_ids:
        logger.warning("%d skill links reference unknown skill ids and are dropped", unknown_ids)
        joined = joined.dropna(subset=["skills"])

    skill_lists = joined.groupby("job_id", sort=False)["skills"].agg(list)

    frame = pd.DataFrame(
        {
            "job_id": postings["job_id"].astype(str),
            "role": postings["job_title_short"],
            "job_title": postings["job_title"],
            "company_id": postings["company_id"].astype(str),
            "job_location": postings["job_location"],
            "country": postings["job_country"],
            "posted_at": pd.to_datetime(postings["job_posted_date"], errors="coerce"),
        }
    )
    frame["raw_skills"] = postings["job_id"].map(skill_lists)
    frame["raw_skills"] = frame["raw_skills"].apply(lambda v: v if isinstance(v, list) else [])

    # A raw skill name can appear under several categories (e.g. "sas" is both
    # programming and analyst_tools). Keep the first category deterministically.
    skill_types = (
        skills.sort_values("skill_id").drop_duplicates("skills").set_index("skills")["type"].to_dict()
    )
    return RawDataset(postings=frame[list(STANDARD_COLUMNS)], skill_types=skill_types, source_key=DATA_JOBS_2023.key)


def load_reference_dataset(download: bool = True) -> RawDataset:
    """Download/verify (optionally) and load the reference public dataset."""
    if not download and not raw_files_present():
        raise DatasetError("Raw files are missing. Run `python -m scripts.download_data` first.")
    files = ensure_raw_files()
    return load_data_jobs(files)


# --------------------------------------------------------------------------- #
# User-supplied CSV
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ColumnMapping:
    """Which columns of an uploaded CSV map to the standard schema."""

    skills: str
    job_id: str | None = None
    role: str | None = None
    job_title: str | None = None
    posted_at: str | None = None
    country: str | None = None
    company_id: str | None = None
    job_location: str | None = None


def parse_skill_cell(value: object) -> list[str]:
    """Parse a skills cell that may be a Python/JSON list or a delimited string."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(v) for v in value if str(v).strip()]
    text = str(value).strip()
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = ast.literal_eval(text)
            if isinstance(parsed, (list, tuple)):
                return [str(v) for v in parsed if str(v).strip()]
        except (ValueError, SyntaxError):
            text = text[1:-1]
    for separator in (";", "|", ","):
        if separator in text:
            return [part.strip().strip("'\"") for part in text.split(separator) if part.strip()]
    return [text.strip("'\"")]


def load_user_csv(source: str | Path | IO[bytes], mapping: ColumnMapping) -> RawDataset:
    """Load an uploaded CSV into the standard postings schema."""
    try:
        data = pd.read_csv(source)
    except (pd.errors.ParserError, UnicodeDecodeError, ValueError) as exc:
        raise DatasetError(f"Could not parse CSV: {exc}") from exc

    _require_columns(data.columns, [c for c in mapping.__dict__.values() if c])

    def column(name: str | None, default: object) -> pd.Series:
        return data[name] if name else pd.Series([default] * len(data), index=data.index)

    frame = pd.DataFrame(
        {
            "job_id": column(mapping.job_id, None).astype(str)
            if mapping.job_id
            else pd.Series(range(len(data)), index=data.index).astype(str),
            "role": column(mapping.role, None),
            "job_title": column(mapping.job_title, None),
            "company_id": column(mapping.company_id, None).astype("string"),
            "job_location": column(mapping.job_location, None),
            "country": column(mapping.country, None),
            "posted_at": pd.to_datetime(column(mapping.posted_at, None), errors="coerce"),
        }
    )
    frame["raw_skills"] = data[mapping.skills].apply(parse_skill_cell)
    return RawDataset(postings=frame[list(STANDARD_COLUMNS)], skill_types={}, source_key="uploaded")


def _require_columns(available: Iterable[str], required: Iterable[str]) -> None:
    missing = sorted(set(required) - set(available))
    if missing:
        raise DatasetError(f"Missing column(s) in CSV: {', '.join(missing)}")
