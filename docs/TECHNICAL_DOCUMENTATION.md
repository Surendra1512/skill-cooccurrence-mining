# Technical Documentation

## Architecture

```
               ┌──────────────────────────┐
               │ config/settings.py       │  thresholds, paths, weights, dataset definition
               └────────────┬─────────────┘
                            │
data/raw ──► src/data_collection/dataset_loader.py ──► standard postings frame (raw_skills)
                            │
                            ▼
         src/preprocessing/  cleaning → skill_normalization → transaction_builder
                            │  (pipeline.py orchestrates + persists to data/processed)
                            ▼
         src/mining/  apriori_miner | fpgrowth_miner → association_rules → lift_filter
                            │  (engine.py: one call = itemsets → rules → filter → rank)
                            ▼
   src/analytics/ skill_frequency · temporal_analysis · evaluation
   src/recommendations/ training_recommender
   src/visualization/ charts (Plotly figures from computed frames only)
                            │
                            ▼
   dashboard/ state (cached computations) · components · 7 page modules ◄── app.py
```

## Key modules

| Module | Public API |
|---|---|
| `dataset_loader` | `ensure_raw_files()`, `load_reference_dataset()`, `load_data_jobs(files)`, `load_user_csv(src, ColumnMapping)`, `parse_skill_cell()` |
| `skill_normalization` | `SkillNormalizer.from_files()`, `.normalize()`, `.normalize_list()`, `.trace()`, `clean_skill_text()`, `display_name()` |
| `cleaning` | `handle_missing_values`, `remove_duplicate_ids`, `remove_duplicate_content`, `drop_postings_without_skills` |
| `transaction_builder` | `build_transactions()`, `one_hot_encode(lists, vocabulary)` |
| `pipeline` | `run_preprocessing(raw)`, `save_preprocessed()`, `load_preprocessed()` |
| `apriori_miner` / `fpgrowth_miner` | `mine_apriori(onehot, min_support, max_len)`, `mine_fpgrowth(...)` → `ItemsetResult` |
| `association_rules` | `generate_rules(itemsets, min_confidence)`, `compute_rule_metrics()` (brute force), `evaluate_rules_on(onehot, rules)` |
| `lift_filter` | `filter_rules()` → `FilterResult`, `rank_rules(rules, weights)`, `strongest_combinations()`, `lift_interpretation()` |
| `engine` | `run_mining(onehot, MiningConfig, RankingWeights)` → `MiningOutcome` |
| `skill_frequency` | `skill_frequency()`, `segment_frequency()`, `time_frequency()`, `pair_cooccurrence()`, `baseline_vs_association()` |
| `temporal_analysis` | `analyse_temporal(postings, MiningConfig, TemporalConfig, labels)` → `TemporalResult` |
| `evaluation` | `compare_algorithms(onehot, config)`, `write_evaluation_report()` |
| `training_recommender` | `recommend(selected, ranked_rules, postings, catalog)` → `RecommendationResult`, `role_skill_gap()` |

## Data contracts
- **Standard postings frame** (loader output): `job_id, role, job_title, company_id, job_location, country, posted_at, raw_skills`.
- **Processed postings** (`postings.parquet`): the same columns with `skills` (sorted canonical list) in place of `raw_skills`.
- **Rules frame**: `antecedents, consequents` (frozensets), `antecedent_support, consequent_support, support, confidence, lift, leverage, conviction, support_count, antecedent_len, consequent_len`, plus `score, rank` after ranking.

## Performance (2 vCPU, full dataset)
| Operation | Time |
|---|---|
| Preprocessing (787k postings) | ~19 s |
| Load processed parquet | ~1 s |
| One-hot encode 670k × 239 | ~2 s |
| FP-Growth, support 0.01, length ≤ 3 | ~4 s |
| Apriori, same thresholds | ~7 s |
| Temporal (4 quarters) | ~6 s |
| Peak memory during mining | < 1 GB |

The dashboard caches the one-hot matrix and mining results by `(dataset, scope, config, weights)`. Mining
runs only when **Generate rules** is pressed. A safety limit (60,000 frequent itemsets) stops runaway
combinatorics at very low thresholds and tells the user what to change.

## Configuration
Edit `config/settings.py`: `MiningConfig` (defaults), `SliderBounds`, `RankingWeights`, `TemporalConfig`
(period, minimum postings, top-K, trend threshold), `RecommenderConfig` (programme size, minimum supporting
postings) and `PreprocessingConfig` (duplicate keys, skill length bounds). Dictionaries in `data/external/`
extend normalisation, display labels and prerequisites without code changes.

## Testing
`python -m pytest` runs 87 tests in under a second:
- `test_preprocessing.py`: loading (relational and user CSV), checksum helper, skill parsing, cleaning,
  normalisation (synonyms, kept distinctions, invalid tokens, traceability), transactions, full pipeline counts, persistence.
- `test_metrics.py`: hand-verified support, confidence and lift; metric identities; brute-force agreement on random data; period re-evaluation.
- `test_mining.py`: itemsets, Apriori = FP-Growth, max length, rule shapes, filtering stages, ranking formula, baseline, algorithm comparison, temporal trends and exclusions.
- `test_recommendations.py`: subset logic, evidence-backed outputs, empty or no-evidence cases, programme counts, minimum-posting rule, role gap.

The dashboard was additionally exercised page by page with `streamlit.testing.AppTest` and in headless Chrome.

## Error handling
- Download or checksum failures raise `DatasetError` with an actionable message.
- Mining on empty selections, unknown algorithms or excessive itemsets raises `MiningError`, which the UI
  shows as an error, not a traceback.
- Temporal analysis with fewer than two eligible periods explains how to fix the selection.
- Uploaded CSVs are validated for parseability and required columns.
