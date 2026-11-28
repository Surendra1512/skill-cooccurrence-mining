# Technical Documentation

## Architecture

```
pipeline/ (Python, run once)                       Website (Next.js on Vercel)
──────────────────────────────                     ─────────────────────────────────────────────
download_data  → SHA-256 verified raw CSVs          public/data/meta.json
build_dataset  → cleaning, normalisation            public/data/transactions.bin.gz
export_web     → public/data/*  ───────────────►         │  fetch + DecompressionStream + decode
               → tests/fixtures/reference.json           ▼
                                                    lib/client/store.tsx  (state, caching)
                                                         │ postMessage
                                                         ▼
                                                    workers/engine.worker.ts
                                                      lib/engine: transactions → apriori | fpgrowth
                                                                  → rules → filter → rank
                                                                  → temporal, compare
                                                         │
                                                    app/* pages + components (charts, tables)
```

## Data format

`transactions.bin.gz` (gzip) contains a header `SKM1`, a uint32 group count, and then for each group:
role (uint8), country (uint8), quarter (uint8, 255 = undated), weight (varint), skill count (uint8) and skill
ids (uint8 each). A group is the set of postings sharing the same skill set, role, country and quarter;
670,261 postings compress to 365,232 groups. Mining weighted groups is mathematically identical to mining
individual postings, which `tests/engine.test.ts` verifies.

## Engine (`lib/engine/`)

| Module | Responsibility |
|---|---|
| `decode.ts` | Parse the binary file into typed arrays |
| `transactions.ts` | Filter groups by role/country/quarter and merge identical skill sets into weighted transactions |
| `apriori.ts` | Level-wise candidate generation with subset pruning, weighted counting |
| `fpgrowth.ts` | Weighted FP-tree and recursive conditional-pattern mining |
| `rules.ts` | Rule generation (all antecedent/consequent splits), metrics, sequential filtering, composite ranking |
| `engine.ts` | One-call mining run, config validation, safety limit, Apriori vs FP-Growth comparison |
| `frequency.ts` | Frequency baseline, segment frequencies, pair counts, baseline-vs-association pairs |
| `temporal.ts` | Quarterly re-mining, rule re-evaluation, trend classification, stability |
| `recommend.ts` | Complementary skills, combined programmes, role skill gap |
| `normalize.ts` / `upload.ts` | Skill normalisation and CSV-to-dataset conversion for uploads |

An itemset is frequent when `count / total >= minSupport`, the same floating-point test as `mlxtend`, so
results match it exactly.

## Performance (full dataset, default thresholds, desktop browser)

| Step | Time |
|---|---|
| Download and decode 670,261 postings | about 1 s |
| FP-Growth (support 1 %, length ≤ 3) | about 0.5 s |
| Apriori, same thresholds | about 0.8 s |
| Temporal analysis (4 quarters) | a few seconds |

Results are cached per dataset, scope, configuration and weights, so revisiting a configuration is instant.

## Testing

* `npm test`: 65 Vitest tests. They cover hand-verified support, confidence and lift; Apriori = FP-Growth on
  random data; weighting; filtering and the ranking formula; baseline; temporal classification;
  recommender; normalisation; CSV upload; and **exact agreement with mlxtend on all 670,261 real postings**
  for two configurations, plus the Python results for temporal analysis and a recommendation case.
* `cd pipeline && python -m pytest`: 87 Python tests for the pipeline.
* The deployed pages were exercised end to end in a headless browser: settings, filters, every tab,
  downloads, CSV upload and mobile layout.

## Accessibility

Semantic landmarks and headings, a skip link, labelled form controls, keyboard-operable tabs and multi-selects,
visible focus, a data-table view for charts, colour-blind-safe chart colours validated for the dark surface,
and reduced motion respected.
