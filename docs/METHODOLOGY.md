# Methodology

## 1. Preprocessing

| Step | Rule | Result on the reference data |
|---|---|---|
| Load | Join `skills_job_dim` to `skills_dim`; one skill list per posting | 787,686 postings |
| Missing values | Categorical fields → `Unknown`; postings without id dropped; unparseable dates kept but excluded from temporal analysis | 1 missing title, 1,053 locations, 52 countries filled |
| Duplicate ids | First occurrence kept | 0 |
| Skill cleaning | Lower-case; collapse whitespace; drop characters other than letters, digits and `+ # . / & -`; trim edge punctuation | |
| Generic suffixes | "python programming" → "python" (also " language", " skill(s)") | |
| Synonyms | `data/external/skill_synonyms.json` maps true variants of the same technology | 13 raw names merged, e.g. powerbi→power bi, golang→go, mongo→mongodb, react.js→react |
| Distinctions kept | Different technologies are never merged: angular ≠ angular.js, vba ≠ visual basic, t-sql ≠ sql, pyspark ≠ spark, sheets ≠ spreadsheet | |
| Invalid tokens | Empty, no letter, over 60 characters, placeholders (n/a, none, …) | 0 in this source |
| Transactions | Set of canonical skills per posting | |
| Empty postings | Removed (no co-occurrence information) | 117,322 |
| Content duplicates | Same company, title, location, timestamp **and** skill set | 103 |
| **Output** | | **670,261 transactions, 239 skills, 5.37 skills per posting on average** |

Traceability: `data/processed/skill_normalization_trace.csv` lists every raw string, its cleaned form,
canonical skill, status and occurrence count. `skill_catalog.csv` lists every canonical skill with its raw
variants.

## 2. Baseline: individual skill frequency
For each skill: postings containing it, share of postings, and rank. Also broken down by role and country
(the dataset has no industry field) and by month or quarter.

**Why it is insufficient.** Frequency ranks skills independently. It cannot say whether two skills are
requested *together* more than chance would produce. The baseline-vs-association table compares observed
joint support with the joint support expected under independence (product of marginals). Among the most
frequent skills, Python and Excel are both common but co-occur less than independence predicts (lift
0.59), while the strongest rules (e.g. Confluence → Jira, lift 24; NumPy → Pandas, lift 18.6) involve skills
outside the top ten.

## 3. Association rule mining
- **Encoding**: boolean posting × skill matrix (NumPy, equivalent to `mlxtend.TransactionEncoder` but
  memory-efficient).
- **Frequent itemsets**: `mlxtend.frequent_patterns.apriori` (with `low_memory=True`) or `fpgrowth`, using
  the same `min_support` and `max_len`.
- **Rules**: `mlxtend.frequent_patterns.association_rules` with `num_itemsets = N`. Every frequent itemset of
  length ≥ 2 yields all antecedent/consequent splits, so both sides may hold one or several skills.

| Metric | Definition |
|---|---|
| Support(A→B) | P(A ∪ B): share of postings that contain all skills in A and B |
| Confidence(A→B) | P(A ∪ B) / P(A) |
| Lift(A→B) | Confidence(A→B) / P(B). Above 1: positive association; 1: independence; below 1: negative |

## 4. Filtering and ranking
Rules are filtered sequentially on minimum support, then confidence, then lift, and the count after each
stage is reported. Surviving rules are ranked by:

```
score = w_lift · scale(log2 lift) + w_conf · scale(confidence) + w_sup · scale(log10 support)
```

`scale` is min-max over the surviving rules. Default weights are 0.4 / 0.4 / 0.2 and can be changed in the
UI and `config/settings.py`. Logs damp the heavy right skew of lift and support. Including support stops
rare, high-lift rules from dominating, so high lift alone never determines rank.

## 5. Temporal analysis
1. Assign postings to quarters (or months).
2. Exclude periods with fewer than the minimum number of postings (default 5,000 for the full dataset;
   2022Q4 with 1,596 postings is excluded).
3. Mine every eligible period independently with the active thresholds and keep each period's top-K rules.
4. Re-evaluate the union of those rules in **every** period, so each has support, confidence and lift for
   every period, even where it fell below the thresholds.
5. Emerging: support rises by ≥15 % from the first to the last period and the least-squares slope is
   positive. Declining is the mirror case. Otherwise the rule is stable.
6. Stability: Jaccard similarity of top-K rule sets between consecutive periods.

## 6. Training recommendations
1. Take the surviving rules whose antecedent ⊆ the learner's skills and whose consequent adds a skill.
2. For each candidate skill, use its best-scoring rule with exactly that skill as consequent (falling back to
   multi-skill consequents only if none exists), so a combination's lift is never attributed to one skill.
3. Order candidates by rule score and explain each with the posting counts behind it.
4. Build a combined programme by greedily adding top candidates while at least 30 postings still require
   the full combination. Group the added skills into modules by skill category.
5. List target roles from the postings requiring the full combination, with each role's over-representation.
6. Prerequisites come from a small curated file (`skill_prerequisites.json`) and are labelled as domain
   knowledge, not mined.
7. No rule means no recommendation. The UI says so instead of guessing.

## 7. Evaluation
- **Metric validation**: hand-computed support, confidence and lift on a 5-posting dataset (single and
  multi-skill antecedents and consequents), plus brute-force agreement on 300 random transactions.
- **Algorithm comparison**: identical one-hot input and thresholds; compares execution time (median of
  repeats), itemset counts, rule counts, itemset Jaccard, maximum support difference and identical surviving
  rule sets.
- **Rule counts** before and after each filter stage.
- **Temporal stability** of top-K rule sets.
