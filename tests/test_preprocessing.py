"""Data loading, skill normalisation, cleaning and transaction building."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pandas as pd
import pytest

from config.settings import PreprocessingConfig
from src.data_collection.dataset_loader import (
    ColumnMapping,
    DatasetError,
    load_data_jobs,
    load_user_csv,
    parse_skill_cell,
    sha256_of,
)
from src.data_collection.dataset_loader import RawDataset
from src.preprocessing.pipeline import load_preprocessed, run_preprocessing, save_preprocessed
from src.preprocessing.skill_normalization import (
    STATUS_INVALID,
    STATUS_MAPPED,
    SkillNormalizer,
    clean_skill_text,
    display_name,
    load_synonyms,
)
from src.preprocessing.transaction_builder import build_transactions, one_hot_encode


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #
def _write_relational(tmp: Path) -> dict[str, Path]:
    pd.DataFrame(
        {
            "job_id": [1, 2, 3],
            "company_id": [10, 11, 12],
            "job_title_short": ["Data Analyst", "Data Engineer", None],
            "job_title": ["Analyst", "Engineer", "Other"],
            "job_location": ["Pune", None, "Delhi"],
            "job_country": ["India", "India", None],
            "job_posted_date": ["2023-01-05 10:00:00", "2023-02-01 09:00:00", "not a date"],
        }
    ).to_csv(tmp / "job_postings_fact.csv", index=False)
    pd.DataFrame({"skill_id": [0, 1, 2, 3], "skills": ["sql", "python", "powerbi", "sql"],
                  "type": ["programming", "programming", "analyst_tools", "programming"]}).to_csv(tmp / "skills_dim.csv", index=False)
    pd.DataFrame({"job_id": [1, 1, 2, 2], "skill_id": [0, 2, 1, 3]}).to_csv(tmp / "skills_job_dim.csv", index=False)
    return {name: tmp / name for name in ("job_postings_fact.csv", "skills_dim.csv", "skills_job_dim.csv")}


def test_load_data_jobs_builds_standard_schema(tmp_path: Path) -> None:
    raw = load_data_jobs(_write_relational(tmp_path))
    frame = raw.postings
    assert list(frame.columns) == ["job_id", "role", "job_title", "company_id", "job_location", "country", "posted_at", "raw_skills"]
    assert frame.loc[frame["job_id"] == "1", "raw_skills"].iloc[0] == ["sql", "powerbi"]
    assert frame.loc[frame["job_id"] == "3", "raw_skills"].iloc[0] == []  # posting without skills
    assert pd.isna(frame.loc[frame["job_id"] == "3", "posted_at"].iloc[0])  # unparseable date → NaT
    assert raw.skill_types["powerbi"] == "analyst_tools"


def test_load_data_jobs_missing_file_raises(tmp_path: Path) -> None:
    files = _write_relational(tmp_path)
    files.pop("skills_dim.csv")
    with pytest.raises(DatasetError):
        load_data_jobs(files)


def test_sha256_of(tmp_path: Path) -> None:
    path = tmp_path / "x.txt"
    path.write_bytes(b"abc")
    assert sha256_of(path) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


@pytest.mark.parametrize(
    ("cell", "expected"),
    [
        ("['python', 'sql']", ["python", "sql"]),
        ("python; sql; excel", ["python", "sql", "excel"]),
        ("python|sql", ["python", "sql"]),
        ("python, sql", ["python", "sql"]),
        ("python", ["python"]),
        ("", []),
        (float("nan"), []),
        (["a", "b"], ["a", "b"]),
    ],
)
def test_parse_skill_cell(cell: object, expected: list[str]) -> None:
    assert parse_skill_cell(cell) == expected


def test_load_user_csv_with_minimal_mapping() -> None:
    csv = io.BytesIO(b"skills,date\n\"['python','sql']\",2023-03-01\n\"excel;tableau\",2023-04-01\n")
    raw = load_user_csv(csv, ColumnMapping(skills="skills", posted_at="date"))
    assert raw.postings["raw_skills"].tolist() == [["python", "sql"], ["excel", "tableau"]]
    assert raw.postings["job_id"].tolist() == ["0", "1"]


def test_load_user_csv_missing_column() -> None:
    with pytest.raises(DatasetError, match="Missing column"):
        load_user_csv(io.BytesIO(b"a,b\n1,2\n"), ColumnMapping(skills="skills"))


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  Python  ", "python"),
        ("C++", "c++"),
        ("C#", "c#"),
        ("Node.JS", "node.js"),
        ("Power   BI", "power bi"),
        ("SQL!!", "sql"),
        ("-excel-", "excel"),
    ],
)
def test_clean_skill_text(raw: str, expected: str) -> None:
    assert clean_skill_text(raw) == expected


def test_normalizer_maps_synonyms_and_suffixes() -> None:
    normalizer = SkillNormalizer(synonyms=load_synonyms())
    assert normalizer.normalize("PowerBI") == "power bi"
    assert normalizer.normalize("golang") == "go"
    assert normalizer.normalize("Python Programming") == "python"
    assert normalizer.normalize("React.js") == "react"


def test_normalizer_keeps_meaningful_distinctions() -> None:
    normalizer = SkillNormalizer(synonyms=load_synonyms())
    pairs = [("angular", "angular.js"), ("vba", "visual basic"), ("sql", "t-sql"), ("spark", "pyspark"), ("c", "c++")]
    for a, b in pairs:
        assert normalizer.normalize(a) != normalizer.normalize(b)


def test_normalizer_removes_invalid_entries() -> None:
    normalizer = SkillNormalizer(synonyms={}, config=PreprocessingConfig(max_skill_length=20))
    for bad in ["", "   ", "1234", "n/a", "None", "x" * 25, "!!!"]:
        assert normalizer.normalize(bad) is None


def test_normalize_list_deduplicates_and_sorts() -> None:
    normalizer = SkillNormalizer(synonyms=load_synonyms())
    assert normalizer.normalize_list(["Python", "SQL", "Excel", "Power BI", "Python Programming"]) == [
        "excel", "power bi", "python", "sql"
    ]


def test_trace_records_every_raw_string() -> None:
    normalizer = SkillNormalizer(synonyms=load_synonyms())
    normalizer.normalize_list(["powerbi", "Power BI", "n/a", "sql"])
    trace = normalizer.trace().set_index("raw_skill")
    assert trace.loc["powerbi", "status"] == STATUS_MAPPED
    assert trace.loc["powerbi", "canonical"] == "power bi"
    assert trace.loc["n/a", "status"] == STATUS_INVALID
    assert trace.loc["sql", "occurrences"] == 1


def test_display_name() -> None:
    assert display_name("power bi", {"power bi": "Power BI"}) == "Power BI"
    assert display_name("machine learning") == "Machine Learning"


# --------------------------------------------------------------------------- #
# Transactions
# --------------------------------------------------------------------------- #
def test_build_transactions_unique_sets() -> None:
    assert build_transactions([["a", "b", "a"], ["c"]]) == [frozenset({"a", "b"}), frozenset({"c"})]


def test_one_hot_encode_matches_input(transactions: list[list[str]]) -> None:
    onehot = one_hot_encode(transactions)
    assert onehot.shape == (5, 4)
    assert list(onehot.columns) == ["excel", "python", "sql", "tableau"]
    assert onehot.sum().to_dict() == {"excel": 4, "python": 4, "sql": 4, "tableau": 1}
    assert all(dtype == bool for dtype in onehot.dtypes)


def test_one_hot_encode_fixed_vocabulary_ignores_unknown() -> None:
    onehot = one_hot_encode([["a", "z"], ["b"]], vocabulary=["a", "b"])
    assert onehot.to_numpy().tolist() == [[True, False], [False, True]]


# --------------------------------------------------------------------------- #
# Full pipeline
# --------------------------------------------------------------------------- #
def _raw_dataset() -> RawDataset:
    postings = pd.DataFrame(
        {
            "job_id": ["1", "2", "2", "3", "4", None, "6"],
            "role": ["Analyst", "Engineer", "Engineer", None, "Analyst", "Analyst", "Analyst"],
            "job_title": ["a", "b", "b", "c", "a", "z", "a"],
            "company_id": ["1", "2", "2", "3", "1", "9", "1"],
            "job_location": ["x", "y", "y", "z", "x", "x", "x"],
            "country": ["IN", "IN", "IN", None, "IN", "IN", "IN"],
            "posted_at": pd.to_datetime(["2023-01-01"] * 4 + ["2023-01-01", "2023-01-01", "2023-01-01"]),
            "raw_skills": [["Python", "SQL"], ["Spark"], ["Spark"], [], ["python", "sql"], ["sql"], ["PYTHON", "Sql "]],
        }
    )
    return RawDataset(postings=postings, skill_types={"python": "programming"}, source_key="test")


def test_run_preprocessing_counts() -> None:
    result = run_preprocessing(_raw_dataset())
    report = result.report
    assert report["original_records"] == 7
    assert report["missing_job_id_removed"] == 1
    assert report["duplicate_ids_removed"] == 1
    assert report["postings_without_skills_removed"] == 1
    # job 4 and job 6 duplicate job 1 (same company/title/location/time and skills)
    assert report["duplicate_content_removed"] == 2
    assert report["cleaned_records"] == 2
    assert report["total_transactions"] == 2
    assert result.postings["skills"].tolist() == [["python", "sql"], ["spark"]]
    assert set(result.skill_catalog["skill"]) == {"python", "sql", "spark"}


def test_uninformative_rows_are_not_deduplicated() -> None:
    postings = pd.DataFrame(
        {
            "job_id": ["1", "2"], "role": [None, None], "job_title": [None, None], "company_id": [None, None],
            "job_location": [None, None], "country": [None, None], "posted_at": pd.to_datetime([None, None]),
            "raw_skills": [["python"], ["python"]],
        }
    )
    result = run_preprocessing(RawDataset(postings, {}, "test"))
    assert result.report["cleaned_records"] == 2


def test_partial_keys_are_not_deduplicated() -> None:
    postings = pd.DataFrame(
        {
            "job_id": ["1", "2"], "role": ["a", "a"], "job_title": [None, None], "company_id": [None, None],
            "job_location": [None, None], "country": [None, None],
            "posted_at": pd.to_datetime(["2023-01-01", "2023-01-01"]), "raw_skills": [["python"], ["python"]],
        }
    )
    assert run_preprocessing(RawDataset(postings, {}, "test")).report["cleaned_records"] == 2


def test_save_and_load_roundtrip(tmp_path: Path) -> None:
    result = run_preprocessing(_raw_dataset())
    paths = dict(
        postings_path=tmp_path / "p.parquet", catalog_path=tmp_path / "c.csv",
        trace_path=tmp_path / "t.csv", report_path=tmp_path / "r.json",
    )
    save_preprocessed(result, **paths)
    loaded = load_preprocessed(**paths)
    assert loaded.postings["skills"].tolist() == result.postings["skills"].tolist()
    assert loaded.report["cleaned_records"] == result.report["cleaned_records"]


def test_load_preprocessed_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_preprocessed(postings_path=tmp_path / "none.parquet")


def test_zip_extraction_member_name() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("job_postings_fact.csv", "a\n1\n")
    with zipfile.ZipFile(buffer) as archive:
        assert "job_postings_fact.csv" in archive.namelist()
