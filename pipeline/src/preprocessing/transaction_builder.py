"""Convert cleaned postings into market-basket transactions.

Each posting becomes one transaction: the *set* of its canonical skills.
The one-hot encoder is implemented with NumPy directly (rather than
``mlxtend.TransactionEncoder``) because it is ~10× more memory efficient on
hundreds of thousands of postings while producing an identical matrix.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np
import pandas as pd


def build_transactions(skill_lists: Iterable[Sequence[str]]) -> list[frozenset[str]]:
    """Return one ``frozenset`` of unique skills per posting."""
    return [frozenset(skills) for skills in skill_lists]


def one_hot_encode(
    skill_lists: Iterable[Sequence[str]],
    vocabulary: Sequence[str] | None = None,
) -> pd.DataFrame:
    """Boolean posting × skill matrix suitable for mlxtend miners.

    Parameters
    ----------
    skill_lists:
        Iterable of skill collections (duplicates within a posting are ignored).
    vocabulary:
        Optional fixed column order; skills outside it are ignored. When
        omitted, the sorted union of all skills is used.
    """
    lists = [list(dict.fromkeys(skills)) for skills in skill_lists]
    if vocabulary is None:
        vocabulary = sorted({skill for skills in lists for skill in skills})
    index = {skill: position for position, skill in enumerate(vocabulary)}

    lengths = np.fromiter((len(s) for s in lists), dtype=np.int64, count=len(lists))
    rows = np.repeat(np.arange(len(lists)), lengths)
    cols = np.fromiter(
        (index.get(skill, -1) for skills in lists for skill in skills), dtype=np.int64, count=int(lengths.sum())
    )
    keep = cols >= 0
    matrix = np.zeros((len(lists), len(vocabulary)), dtype=bool)
    matrix[rows[keep], cols[keep]] = True
    return pd.DataFrame(matrix, columns=list(vocabulary))
