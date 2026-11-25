"""Shared types and helpers for frequent-itemset miners."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import pandas as pd

MinerFn = Callable[..., pd.DataFrame]


class MiningError(RuntimeError):
    """Raised when mining cannot be performed on the given input."""


@dataclass(frozen=True)
class ItemsetResult:
    """Frequent itemsets together with run metadata."""

    algorithm: str
    itemsets: pd.DataFrame  # columns: support, itemsets, length, support_count
    n_transactions: int
    min_support: float
    max_len: int
    seconds: float


def validate_onehot(onehot: pd.DataFrame) -> None:
    """Check that the input is a non-empty boolean posting × skill matrix."""
    if onehot.empty or onehot.shape[1] == 0:
        raise MiningError("No transactions to mine — the current selection is empty.")
    if not all(dtype == bool for dtype in onehot.dtypes):
        raise MiningError("One-hot matrix must contain only boolean columns.")


def run_miner(
    algorithm: str,
    miner: MinerFn,
    onehot: pd.DataFrame,
    min_support: float,
    max_len: int,
    **kwargs: object,
) -> ItemsetResult:
    """Execute an mlxtend miner with timing and standardised output."""
    validate_onehot(onehot)
    if not 0.0 < min_support <= 1.0:
        raise MiningError("min_support must be in (0, 1].")
    started = time.perf_counter()
    itemsets = miner(onehot, min_support=min_support, use_colnames=True, max_len=max_len, **kwargs)
    seconds = time.perf_counter() - started

    n = len(onehot)
    itemsets = itemsets.copy()
    itemsets["itemsets"] = itemsets["itemsets"].map(frozenset)
    itemsets["length"] = itemsets["itemsets"].map(len)
    itemsets["support_count"] = (itemsets["support"] * n).round().astype(int)
    itemsets = itemsets.sort_values(["length", "support"], ascending=[True, False], ignore_index=True)
    return ItemsetResult(algorithm, itemsets, n, min_support, max_len, seconds)
