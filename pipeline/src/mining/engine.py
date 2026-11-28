"""One-call mining pipeline: itemsets → rules → filtering → ranking."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import pandas as pd

from config.settings import MiningConfig, RankingWeights
from src.mining.apriori_miner import ALGORITHM_NAME as APRIORI, mine_apriori
from src.mining.association_rules import generate_rules
from src.mining.base import ItemsetResult, MiningError
from src.mining.fpgrowth_miner import ALGORITHM_NAME as FPGROWTH, mine_fpgrowth
from src.mining.lift_filter import FilterResult, filter_rules, rank_rules

MINERS: dict[str, Callable[[pd.DataFrame, float, int], ItemsetResult]] = {
    APRIORI: mine_apriori,
    FPGROWTH: mine_fpgrowth,
}

# Guard against combinatorial explosion from very low thresholds.
MAX_ITEMSETS = 60_000


@dataclass(frozen=True)
class MiningOutcome:
    """Everything produced by one mining run."""

    config: MiningConfig
    itemsets: ItemsetResult
    all_rules: pd.DataFrame
    filtered: FilterResult
    ranked: pd.DataFrame


def mine_itemsets(onehot: pd.DataFrame, algorithm: str, min_support: float, max_len: int) -> ItemsetResult:
    """Dispatch to the selected frequent-itemset algorithm."""
    try:
        miner = MINERS[algorithm]
    except KeyError as exc:
        raise MiningError(f"Unknown algorithm '{algorithm}'. Choose from {sorted(MINERS)}.") from exc
    result = miner(onehot, min_support, max_len)
    if len(result.itemsets) > MAX_ITEMSETS:
        raise MiningError(
            f"{len(result.itemsets):,} frequent itemsets exceed the safety limit of {MAX_ITEMSETS:,}. "
            "Increase minimum support or reduce maximum itemset length."
        )
    return result


def run_mining(onehot: pd.DataFrame, config: MiningConfig, weights: RankingWeights | None = None) -> MiningOutcome:
    """Mine, generate every rule, filter by thresholds and rank."""
    itemsets = mine_itemsets(onehot, config.algorithm, config.min_support, config.max_len)
    all_rules = generate_rules(itemsets, min_confidence=0.0)
    filtered = filter_rules(all_rules, config.min_support, config.min_confidence, config.min_lift)
    ranked = rank_rules(filtered.rules, weights)
    return MiningOutcome(config=config, itemsets=itemsets, all_rules=all_rules, filtered=filtered, ranked=ranked)
