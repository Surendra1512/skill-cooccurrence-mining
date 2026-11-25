"""Page 7 — Dataset & Methodology, plus uploading an organisation's own data."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from config.settings import DATA_JOBS_2023, SETTINGS
from dashboard.components import kpi_row, page_header
from dashboard.state import AppContext, register_upload
from src.data_collection.dataset_loader import ColumnMapping, DatasetError

_NONE = "— not available —"


def render(ctx: AppContext) -> None:
    page_header("Dataset & Methodology", "Sources, preprocessing, algorithms, evaluation and limitations.")
    tab_data, tab_pre, tab_algo, tab_eval, tab_limits, tab_upload = st.tabs(
        ["Dataset", "Preprocessing", "Algorithms & ranking", "Evaluation", "Limitations", "Use your own data"]
    )
    with tab_data:
        _dataset_section()
    with tab_pre:
        _preprocessing_section(ctx)
    with tab_algo:
        _algorithm_section()
    with tab_eval:
        st.markdown(
            """
- **Metric correctness** — support, confidence and lift are validated in the automated test suite against
  hand-computed values on small datasets, and against a brute-force counter on random data.
- **Algorithm consistency** — Apriori and FP-Growth run on the identical one-hot matrix and thresholds; their
  itemsets, supports and surviving rules are compared (Association Rule Mining → *Apriori vs FP-Growth*).
- **Filtering transparency** — the number of rules removed at each threshold stage is reported.
- **Temporal stability** — Jaccard similarity of top-K rule sets between consecutive periods.
- **Baseline comparison** — frequency-only pairings versus observed co-occurrence and lift (Skill Analysis →
  *Baseline vs association*).
- A full evaluation report is produced by `python -m scripts.run_evaluation` into `outputs/reports/`.
"""
        )
    with tab_limits:
        _limitations()
    with tab_upload:
        _upload_section()


def _dataset_section() -> None:
    src = DATA_JOBS_2023
    st.markdown(f"### {src.title}")
    st.markdown(src.description)
    st.markdown(
        f"""
| Field | Value |
|---|---|
| Publisher | {src.publisher} |
| Original source | [{src.original_url}]({src.original_url}) |
| Download mirror used | [{src.mirror_url}]({src.mirror_url}) |
| Licence | {src.licence} |
| Download method | `python -m scripts.download_data` — HTTPS download with SHA-256 verification |
| Files | {", ".join(f"`{f.name}`" for f in src.files)} |
| Skill format | Relational: one row per (job_id, skill_id) in `skills_job_dim`, skill names and categories in `skills_dim` |
| Date coverage | 31 Dec 2022 – 31 Dec 2023 |
"""
    )
    st.markdown("**Citation**  \nBarousse, L. (2023). *data_jobs* [Dataset]. Hugging Face. "
                "https://huggingface.co/datasets/lukebarousse/data_jobs")
    st.caption("Raw files are kept unmodified in data/raw/; all derived files are written to data/processed/. "
               "See docs/DATASET_SOURCES.md for the alternatives considered.")


def _preprocessing_section(ctx: AppContext) -> None:
    report = ctx.dataset.report
    kpi_row(
        [
            ("Original records", f"{report['original_records']:,}", None),
            ("Cleaned transactions", f"{report['cleaned_records']:,}", None),
            ("Duplicates removed", f"{report['duplicate_records_removed']:,}", None),
            ("Unique skills", f"{report['unique_skills']:,}", None),
        ]
    )
    st.markdown(
        """
1. **Load** postings and the posting–skill bridge table; join skill names.
2. **Missing values** — categorical fields filled with *Unknown*; postings without an id are dropped.
3. **Duplicate ids** removed (first occurrence kept).
4. **Skill normalisation** — lower-casing, whitespace collapsing, removal of characters not used in technology
   names (`+ # . / & -` are kept so C++, C#, Node.js stay distinct), stripping generic suffixes
   ("python programming" → "python"), mapping spelling variants through an extendable synonym dictionary
   (`data/external/skill_synonyms.json`), and removal of invalid tokens (empty, no letters, placeholders).
5. **Transactions** — each posting becomes the *set* of its canonical skills (duplicates within a posting collapse).
6. **Empty postings** (no valid skill) are removed — they carry no co-occurrence information.
7. **Content duplicates** — re-posts with identical company, title, location, timestamp *and* skill set are removed.
"""
    )
    missing = pd.DataFrame(report["missing_values_by_column"].items(), columns=["column", "missing values"])
    st.dataframe(missing, hide_index=True, width="stretch")
    st.markdown("**Most frequent skills after cleaning**")
    st.dataframe(pd.DataFrame(report["top_skills"]), hide_index=True, width="stretch",
                 column_config={"share": st.column_config.NumberColumn(format="percent")})


def _algorithm_section() -> None:
    w = SETTINGS.ranking
    st.markdown(
        f"""
**Apriori** generates candidate itemsets level by level and prunes any candidate with an infrequent subset
(support is anti-monotone). **FP-Growth** compresses transactions into a frequent-pattern tree and mines it
recursively without candidate generation. Both are exact: for the same thresholds they return the same
itemsets. Implementations: `mlxtend.frequent_patterns` (Apriori with `low_memory=True`).

**Rule generation** — every frequent itemset of length ≥ 2 is split into all antecedent/consequent pairs, so
rules may have single- or multi-skill antecedents and consequents.

| Metric | Formula |
|---|---|
| Support(A → B) | P(A ∪ B) |
| Confidence(A → B) | P(A ∪ B) / P(A) |
| Lift(A → B) | Confidence(A → B) / P(B) |

**Filtering** removes rules below minimum support, then confidence, then lift.

**Ranking score** (each component min-max scaled to 0–1 over the surviving rules):

`score = w_lift · scale(log₂ lift) + w_conf · scale(confidence) + w_sup · scale(log₁₀ support)`

Default weights: lift {w.lift}, confidence {w.confidence}, support {w.support} (adjustable in the sidebar).
Logs damp the heavy right skew of lift and support so a few extreme rules do not compress everything else, and
including support prevents rare-but-high-lift rules from dominating.

**Temporal analysis** re-mines each period (quarters by default; periods under the minimum posting count are
excluded), tracks the union of each period's top-K rules across all periods, and labels a rule emerging or
declining when its support changes by ≥ {SETTINGS.temporal.trend_min_relative_change:.0%} first→last with a
consistent least-squares slope.

**Recommendations** use only surviving rules whose antecedent the learner already has; candidate skills are
ordered by the score of their strongest supporting rule. A combined programme greedily adds the top candidates
while at least {SETTINGS.recommender.min_programme_postings} postings still require the full combination.
"""
    )


def _limitations() -> None:
    st.markdown(
        """
- **Sector coverage.** The verified dataset covers data and technology roles (analysts, engineers, scientists,
  cloud and software engineers). It does **not** represent cooperative-sector, agricultural, manufacturing or
  blue-collar vacancies. Findings describe this labour market only. The pipeline is domain-independent: an
  organisation can upload its own postings (e.g. cooperative society vacancies) in *Use your own data*.
- **Geography.** Postings span 160 countries with a US/Europe emphasis; India-specific demand is a subset.
- **Time window.** One year (2023). Temporal trends are quarter-to-quarter shifts inside that window, not
  long-run trends. A sliver of postings dated 31 Dec 2022 is excluded from period comparison.
- **Skill extraction.** Skills were extracted by the dataset publisher using a fixed keyword taxonomy of 259
  tokens; skills outside that taxonomy (including soft skills) are absent, and a few tokens are ambiguous
  (e.g. "flow", "unity", "planner" may match non-technology meanings).
- **No industry field.** Industry-wise analysis is replaced by role- and country-wise analysis.
- **Associations are not causation**, and co-occurrence in postings reflects employer requests, not whether
  training in a combination leads to employment.
- **Curated prerequisites** in the Training Planner are domain knowledge, not mined from data.
"""
    )


def _upload_section() -> None:
    st.markdown(
        "Upload a CSV of job postings — for example a cooperative's vacancy records — and run the identical "
        "pipeline on it. Only a skills column is required; skills may be a list (`['a', 'b']`) or separated by "
        "`;`, `|` or `,`."
    )
    upload = st.file_uploader("Postings CSV", type=["csv"], key="mu_file")
    if upload is None:
        return
    try:
        preview = pd.read_csv(upload, nrows=200)
    except (pd.errors.ParserError, UnicodeDecodeError, ValueError) as exc:
        st.error(f"Could not read CSV: {exc}")
        return
    st.dataframe(preview.head(10), width="stretch", hide_index=True)
    columns = [_NONE, *preview.columns]

    def pick(label: str, key: str, guesses: tuple[str, ...]) -> str | None:
        guess = next((c for c in preview.columns if c.lower() in guesses), _NONE)
        value = st.selectbox(label, columns, index=columns.index(guess), key=key)
        return None if value == _NONE else value

    with st.form("mu_mapping"):
        c1, c2 = st.columns(2)
        with c1:
            skills = pick("Skills column (required)", "mu_skills", ("skills", "job_skills", "skill_list"))
            job_id = pick("Posting id", "mu_id", ("job_id", "id"))
            role = pick("Role / job category", "mu_role", ("role", "job_title_short", "category"))
            title = pick("Job title", "mu_title", ("title", "job_title"))
        with c2:
            posted = pick("Posting date", "mu_date", ("date", "posted_at", "job_posted_date", "posting_date"))
            country = pick("Country / state", "mu_country", ("country", "state", "job_country"))
            company = pick("Employer id / name", "mu_company", ("company", "company_id", "employer"))
            location = pick("Location", "mu_location", ("location", "job_location", "district"))
        submitted = st.form_submit_button("Process dataset", type="primary", icon=":material/play_arrow:")
    if submitted:
        if skills is None:
            st.error("Select the skills column.")
            return
        mapping = ColumnMapping(skills=skills, job_id=job_id, role=role, job_title=title, posted_at=posted,
                                country=country, company_id=company, job_location=location)
        try:
            with st.spinner("Preprocessing uploaded postings…"):
                dataset_id = register_upload(upload.getvalue(), upload.name, mapping)
        except DatasetError as exc:
            st.error(str(exc))
            return
        st.session_state["dataset_id"] = dataset_id
        st.success("Dataset processed. It is now selected in the sidebar.")
        st.rerun()
