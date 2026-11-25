"""Dataset registry, scoping and cached computations for the dashboard.

Heavy objects (600k-row frames, one-hot matrices) are never hashed by
Streamlit: cached functions take small hashable keys (dataset id, scope
tuples, frozen configs) and resolve the data from a resource registry.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import streamlit as st

from config.settings import SETTINGS, MiningConfig, RankingWeights, TemporalConfig
from src.analytics.evaluation import AlgorithmComparison, compare_algorithms
from src.analytics.skill_frequency import skill_frequency
from src.analytics.temporal_analysis import TemporalResult, analyse_temporal
from src.data_collection.dataset_loader import ColumnMapping, load_reference_dataset, load_user_csv
from src.mining.association_rules import itemset_label
from src.mining.engine import MiningOutcome, run_mining
from src.preprocessing.pipeline import PreprocessedDataset, load_preprocessed, run_preprocessing, save_preprocessed
from src.preprocessing.transaction_builder import one_hot_encode

REFERENCE_ID = "reference"
REFERENCE_LABEL = "Data Jobs 2023 — verified public dataset"


# --------------------------------------------------------------------------- #
# Dataset registry
# --------------------------------------------------------------------------- #
@st.cache_resource(show_spinner=False)
def _registry() -> dict[str, tuple[str, PreprocessedDataset]]:
    """Process-wide registry of user-uploaded processed datasets."""
    return {}


@st.cache_resource(show_spinner="Loading processed dataset…")
def _reference_dataset() -> PreprocessedDataset:
    return load_preprocessed()


def reference_available() -> bool:
    try:
        _reference_dataset()
        return True
    except FileNotFoundError:
        return False


def build_reference_dataset() -> None:
    """Download (if needed), verify and preprocess the reference dataset."""
    dataset = run_preprocessing(load_reference_dataset(download=True))
    save_preprocessed(dataset)
    _reference_dataset.clear()


def register_upload(file_bytes: bytes, file_name: str, mapping: ColumnMapping) -> str:
    """Preprocess an uploaded CSV and register it; returns its dataset id."""
    import io

    digest = hashlib.sha256(file_bytes + repr(mapping).encode()).hexdigest()[:12]
    dataset_id = f"upload:{digest}"
    if dataset_id not in _registry():
        raw = load_user_csv(io.BytesIO(file_bytes), mapping)
        _registry()[dataset_id] = (f"Uploaded — {file_name}", run_preprocessing(raw))
    return dataset_id


def available_datasets() -> dict[str, str]:
    options = {REFERENCE_ID: REFERENCE_LABEL} if reference_available() else {}
    options.update({key: label for key, (label, _) in _registry().items()})
    return options


def get_dataset(dataset_id: str) -> PreprocessedDataset:
    if dataset_id == REFERENCE_ID:
        return _reference_dataset()
    return _registry()[dataset_id][1]


# --------------------------------------------------------------------------- #
# Scoped, cached computations
# --------------------------------------------------------------------------- #
Scope = tuple[tuple[str, ...], tuple[str, ...]]  # (roles, countries); empty = all


@st.cache_resource(show_spinner=False, max_entries=8)
def scoped_postings(dataset_id: str, scope: Scope) -> pd.DataFrame:
    postings = get_dataset(dataset_id).postings
    roles, countries = scope
    mask = np.ones(len(postings), dtype=bool)
    if roles:
        mask &= postings["role"].isin(roles).to_numpy()
    if countries:
        mask &= postings["country"].isin(countries).to_numpy()
    return postings.loc[mask].reset_index(drop=True)


@st.cache_resource(show_spinner="Encoding transactions…", max_entries=4)
def scoped_onehot(dataset_id: str, scope: Scope) -> pd.DataFrame:
    vocabulary = get_dataset(dataset_id).skill_catalog["skill"].tolist()
    return one_hot_encode(scoped_postings(dataset_id, scope)["skills"], vocabulary=vocabulary)


@st.cache_resource(show_spinner=False, max_entries=8)
def scoped_frequency(dataset_id: str, scope: Scope) -> pd.DataFrame:
    labels = skill_labels(dataset_id)
    freq = skill_frequency(scoped_postings(dataset_id, scope)["skills"])
    return freq.assign(label=freq["skill"].map(lambda s: labels.get(s, s)))


@st.cache_resource(show_spinner="Mining frequent itemsets and rules…", max_entries=12)
def mining_outcome(dataset_id: str, scope: Scope, config: MiningConfig, weights: RankingWeights) -> MiningOutcome:
    outcome = run_mining(scoped_onehot(dataset_id, scope), config, weights)
    labels = skill_labels(dataset_id)
    ranked = add_rule_labels(outcome.ranked, labels)
    all_rules = add_rule_labels(outcome.all_rules, labels)
    return MiningOutcome(outcome.config, outcome.itemsets, all_rules, outcome.filtered, ranked)


@st.cache_resource(show_spinner="Comparing Apriori and FP-Growth…", max_entries=4)
def algorithm_comparison(dataset_id: str, scope: Scope, config: MiningConfig) -> AlgorithmComparison:
    return compare_algorithms(scoped_onehot(dataset_id, scope), config)


@st.cache_resource(show_spinner="Mining every period…", max_entries=6)
def temporal_result(
    dataset_id: str, scope: Scope, config: MiningConfig, temporal: TemporalConfig, weights: RankingWeights
) -> TemporalResult:
    return analyse_temporal(scoped_postings(dataset_id, scope), config, temporal, skill_labels(dataset_id), weights)


@st.cache_resource(show_spinner=False, max_entries=8)
def skill_labels(dataset_id: str) -> dict[str, str]:
    catalog = get_dataset(dataset_id).skill_catalog
    return dict(zip(catalog["skill"], catalog["label"]))


def add_rule_labels(rules: pd.DataFrame, labels: dict[str, str]) -> pd.DataFrame:
    """Readable antecedent/consequent/rule strings for display and export."""
    if rules.empty:
        return rules.assign(antecedent=pd.Series(dtype=str), consequent=pd.Series(dtype=str), rule=pd.Series(dtype=str))
    antecedent = rules["antecedents"].map(lambda s: itemset_label(s, labels))
    consequent = rules["consequents"].map(lambda s: itemset_label(s, labels))
    return rules.assign(antecedent=antecedent, consequent=consequent, rule=antecedent + " → " + consequent)


# --------------------------------------------------------------------------- #
# Context passed to every page
# --------------------------------------------------------------------------- #
@dataclass
class AppContext:
    dataset_id: str
    dataset_label: str
    scope: Scope
    mining_config: MiningConfig
    weights: RankingWeights
    extras: dict[str, Any] = field(default_factory=dict)

    @property
    def dataset(self) -> PreprocessedDataset:
        return get_dataset(self.dataset_id)

    @property
    def postings(self) -> pd.DataFrame:
        return scoped_postings(self.dataset_id, self.scope)

    @property
    def labels(self) -> dict[str, str]:
        return skill_labels(self.dataset_id)

    @property
    def catalog(self) -> pd.DataFrame:
        return self.dataset.skill_catalog

    def onehot(self) -> pd.DataFrame:
        return scoped_onehot(self.dataset_id, self.scope)

    def frequency(self) -> pd.DataFrame:
        return scoped_frequency(self.dataset_id, self.scope)

    def mining(self) -> MiningOutcome:
        return mining_outcome(self.dataset_id, self.scope, self.mining_config, self.weights)

    def scope_description(self) -> str:
        roles, countries = self.scope
        parts = [f"roles: {', '.join(roles)}" if roles else "all roles",
                 f"countries: {', '.join(countries)}" if countries else "all countries"]
        return "; ".join(parts)


DEFAULT_TEMPORAL: TemporalConfig = SETTINGS.temporal
