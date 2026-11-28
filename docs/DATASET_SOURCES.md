# Dataset Sources

## Selected dataset: Data Jobs 2023

| # | Field | Value |
|---|---|---|
| 1 | Dataset name | `data_jobs` — real data/tech job postings with extracted skills (2023) |
| 2 | Original source URL | https://huggingface.co/datasets/lukebarousse/data_jobs |
| 2b | Mirror actually downloaded | https://github.com/subhankar-das18/SQL-Job-Market-Analysis (`data/csv_files/`) |
| 3 | Publisher | Luke Barousse. Postings collected by his job-search bot from Google Jobs listings (LinkedIn, Indeed, Glassdoor and other boards); skills extracted by keyword matching against a fixed taxonomy |
| 4 | Download method | `cd pipeline && python -m scripts.download_data`: HTTPS download of three files, SHA-256 verified, zip extracted |
| 5 | Licence | Apache-2.0 as declared on the Hugging Face dataset card. The relational CSVs are the same data distributed with Barousse's SQL course; the GitHub mirror declares no separate licence |
| 6 | Records | 787,686 postings; 3,669,604 posting–skill links; 259 skill entries (252 distinct names) |
| 7 | Columns used | `job_postings_fact`: job_id, company_id, job_title_short, job_title, job_location, job_country, job_posted_date (also available but unused: job_via, schedule type, remote flag, degree/insurance flags, salary fields). `skills_dim`: skill_id, skills, type. `skills_job_dim`: job_id, skill_id |
| 8 | Date coverage | 2022-12-31 06:00 to 2023-12-31 06:12 (the Dec 2022 rows are a timezone sliver on 31 Dec) |
| 9 | Skill format | Normalised relational bridge table; skill names are lower-case tokens with 10 categories (programming, libraries, cloud, databases, analyst_tools, webframeworks, os, other, async, sync) |
| 10 | Known limitations | Data/tech roles only; one year; keyword-based extraction (no soft skills, some ambiguous tokens); no industry field; 117,322 postings have no extracted skill; US/Europe emphasis |

### Files and checksums

| File | Size | SHA-256 |
|---|---:|---|
| `job_postings_fact.zip` → `job_postings_fact.csv` | 29.7 MB → 129.3 MB | `661b106b…4350` → `ac6b4c9a…a37d` |
| `skills_dim.csv` | 5.5 KB | `71e1064a…3121` |
| `skills_job_dim.csv` | 37.3 MB | `7ddc6cb8…2f85` |

Full hashes are in `config/settings.py`. The posting count (787,686) matches the figure reported for the
original dataset by independent projects that use it.

### Citation
> Barousse, L. (2023). *data_jobs* [Dataset]. Hugging Face. https://huggingface.co/datasets/lukebarousse/data_jobs

## Why this dataset
- **Real postings** with **pre-extracted skill lists**, which is exactly the transaction format association mining needs.
- **Scale**: 670k transactions after cleaning, enough for stable support estimates even at 1 % support.
- **Posting dates** across a full year, which enables quarterly and monthly temporal analysis.
- **Role** and **country** fields for segment analysis.
- **Permissive licence** (Apache-2.0).

## Alternatives considered

| Dataset | Source | Why not selected |
|---|---|---|
| LinkedIn Job Postings 2023–2024 (arshkon), 124k postings with a `job_skills` table | Kaggle | Kaggle was unreachable from the build environment; its skill table holds broad LinkedIn skill *categories* (≈35 abbreviations such as IT, SALE, MGMT), which are too coarse for training design |
| `data_jobs` original parquet/CSV | Hugging Face | Same data as the selection. Hugging Face was blocked from the build environment, so the identical relational export on GitHub was used |
| JobVision job posts, xanderios LinkedIn postings | Hugging Face | Unreachable from the build environment; no verified skill lists |
| Indeed Hiring Lab job postings tracker | GitHub | Aggregate posting indices only, with no per-posting skills |
| Lightcast / People Data Labs job postings | Commercial | Paid licence |
| India data.gov.in / NCS portal | Government | No public per-posting skill-level dataset found; data.gov.in unreachable from the build environment |

## Reproducing the download manually
If GitHub is blocked on your network, download these three files in a browser into
`pipeline/data/raw/data_jobs_2023/` and run `python -m scripts.build_dataset --offline` (checksums are still verified):

```
https://raw.githubusercontent.com/subhankar-das18/SQL-Job-Market-Analysis/main/data/csv_files/job_postings_fact.zip
https://raw.githubusercontent.com/subhankar-das18/SQL-Job-Market-Analysis/main/data/csv_files/skills_dim.csv
https://raw.githubusercontent.com/subhankar-das18/SQL-Job-Market-Analysis/main/data/csv_files/skills_job_dim.csv
```

## Synthetic data
None is used by the website. The automated tests use small, explicitly hand-written transaction lists
(`tests/engine.test.ts`, `pipeline/tests/`) to verify calculations; they are never shown in the dashboard.
