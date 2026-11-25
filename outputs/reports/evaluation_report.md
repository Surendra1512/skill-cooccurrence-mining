# Evaluation Report

All numbers below were computed by `python -m scripts.run_evaluation` on the processed dataset.

## 1. Data
- Original records: 787,686
- Transactions mined: 670,261
- Unique skills: 239
- Average skills per posting: 5.374

## 2. Configuration
```json
{
  "algorithm": "FP-Growth",
  "min_support": 0.01,
  "min_confidence": 0.3,
  "min_lift": 1.2,
  "max_len": 3
}
```

## 3. Apriori vs FP-Growth
| Algorithm | Time (s) | Frequent itemsets | Rules generated | Rules surviving filters |
|---|---:|---:|---:|---:|
| Apriori | 7.21 | 1,002 | 3,944 | 1,386 |
| FP-Growth | 4.34 | 1,002 | 3,944 | 1,386 |

- Identical frequent itemsets: **True** (Jaccard 1.0000)
- Maximum support difference on shared itemsets: 0.00e+00
- Identical surviving rule sets: **True**

## 4. Rule set
- Frequent itemsets: 1,002
- Rules generated: 3,944
- Rules after support: 3,944
- Rules after confidence: 1,525
- Rules after lift (surviving): 1,386
- Median lift of surviving rules: 2.38
- Top 5 combinations: NumPy + Pandas + Python (lift 18.72, 17,625 postings); NumPy + Pandas (lift 18.58, 18,320 postings); NumPy + Pandas + SQL (lift 18.94, 11,081 postings); NumPy + Pandas + scikit-learn (lift 19.23, 7,850 postings); Confluence + Jira (lift 23.96, 9,068 postings)
- Top 50 rules involving a skill outside the 10 most frequent: 48 of 50

## 5. Baseline (individual frequency) vs association mining
Pairs of the most frequent skills, ordered as a frequency-only planner would rank them, with the lift actually observed:

| Skill A | Skill B | Observed support | Expected if independent | Lift |
|---|---|---:|---:|---:|
| SQL | Python | 0.3786 | 0.3278 | 1.16 |
| SQL | AWS | 0.1366 | 0.1251 | 1.09 |
| Python | AWS | 0.1646 | 0.1238 | 1.33 |
| SQL | Azure | 0.1352 | 0.1140 | 1.19 |
| SQL | R | 0.1367 | 0.1127 | 1.21 |
| Python | Azure | 0.1332 | 0.1129 | 1.18 |
| SQL | Tableau | 0.1442 | 0.1094 | 1.32 |
| Python | R | 0.1793 | 0.1116 | 1.61 |
| SQL | Excel | 0.1001 | 0.1093 | 0.92 |
| Python | Tableau | 0.1196 | 0.1083 | 1.10 |
| Python | Excel | 0.0639 | 0.1082 | 0.59 |
| SQL | Spark | 0.1159 | 0.0987 | 1.18 |

## 6. Temporal stability
- Periods analysed: 2023Q1, 2023Q2, 2023Q3, 2023Q4
- Excluded periods: 2022Q4 (1,596 postings)
- Rules tracked: 33
- Emerging / stable / declining: 11 / 18 / 4
- Top k jaccard between consecutive periods: 2023Q1→2023Q2: 0.85, 2023Q2→2023Q3: 0.67, 2023Q3→2023Q4: 0.79
