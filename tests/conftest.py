"""Shared fixtures: a tiny hand-verifiable dataset.

Transactions (N = 5)::

    1: {python, sql, excel}
    2: {python, sql}
    3: {python, excel}
    4: {sql, excel}
    5: {python, sql, excel, tableau}

Counts: python 4, sql 4, excel 4, tableau 1,
python+sql 3, python+excel 3, sql+excel 3, python+sql+excel 2.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TRANSACTIONS: list[list[str]] = [
    ["python", "sql", "excel"],
    ["python", "sql"],
    ["python", "excel"],
    ["sql", "excel"],
    ["python", "sql", "excel", "tableau"],
]


@pytest.fixture
def transactions() -> list[list[str]]:
    return [list(t) for t in TRANSACTIONS]


@pytest.fixture
def onehot(transactions: list[list[str]]) -> pd.DataFrame:
    from src.preprocessing.transaction_builder import one_hot_encode

    return one_hot_encode(transactions)


@pytest.fixture
def postings(transactions: list[list[str]]) -> pd.DataFrame:
    """Processed-postings frame with roles and quarterly dates."""
    dates = pd.to_datetime(["2023-01-15", "2023-02-15", "2023-04-15", "2023-05-15", "2023-05-20"])
    return pd.DataFrame(
        {
            "job_id": [str(i) for i in range(5)],
            "role": ["Data Analyst", "Data Analyst", "Data Scientist", "Data Analyst", "Data Scientist"],
            "job_title": ["t"] * 5,
            "company_id": [str(i) for i in range(5)],
            "job_location": ["x"] * 5,
            "country": ["India"] * 5,
            "posted_at": dates,
            "skills": [sorted(t) for t in transactions],
        }
    )


@pytest.fixture
def catalog() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "skill": ["python", "sql", "excel", "tableau"],
            "label": ["Python", "SQL", "Excel", "Tableau"],
            "category": ["programming", "programming", "analyst_tools", "analyst_tools"],
            "postings": [4, 4, 4, 1],
            "share": [0.8, 0.8, 0.8, 0.2],
            "raw_variants": ["python", "sql", "excel", "tableau"],
        }
    )
