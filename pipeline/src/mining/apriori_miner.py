"""Apriori frequent-itemset mining (level-wise candidate generation).

Apriori grows itemsets one item at a time and prunes any candidate with an
infrequent subset (the anti-monotone property of support). It is simple and
exact but scans the data once per level, so it is slower than FP-Growth on
large inputs. ``low_memory=True`` keeps memory bounded on 600k+ postings.
"""

from __future__ import annotations

import pandas as pd
from mlxtend.frequent_patterns import apriori

from src.mining.base import ItemsetResult, run_miner

ALGORITHM_NAME = "Apriori"


def mine_apriori(onehot: pd.DataFrame, min_support: float, max_len: int) -> ItemsetResult:
    """Return frequent itemsets with support ≥ ``min_support`` using Apriori."""
    return run_miner(ALGORITHM_NAME, apriori, onehot, min_support, max_len, low_memory=True)
