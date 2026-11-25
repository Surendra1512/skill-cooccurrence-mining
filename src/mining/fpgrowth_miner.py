"""FP-Growth frequent-itemset mining (pattern growth on an FP-tree).

FP-Growth compresses the transactions into a prefix tree in two passes and
mines it recursively without generating candidates. It returns exactly the
same itemsets as Apriori for the same thresholds, usually much faster.
"""

from __future__ import annotations

import pandas as pd
from mlxtend.frequent_patterns import fpgrowth

from src.mining.base import ItemsetResult, run_miner

ALGORITHM_NAME = "FP-Growth"


def mine_fpgrowth(onehot: pd.DataFrame, min_support: float, max_len: int) -> ItemsetResult:
    """Return frequent itemsets with support ≥ ``min_support`` using FP-Growth."""
    return run_miner(ALGORITHM_NAME, fpgrowth, onehot, min_support, max_len)
