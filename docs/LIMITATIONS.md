# Limitations

1. **Sector coverage.** The verified public dataset covers data and technology roles (data analysts,
   engineers and scientists, business analysts, software, ML and cloud engineers). It does not represent
   cooperative-sector, agricultural, dairy, banking-cooperative, manufacturing or blue-collar vacancies.
   Findings describe this labour market only. No public per-posting dataset of Indian cooperative-sector
   vacancies with skill lists could be found or accessed. The pipeline is domain-independent, and any
   organisation can upload its own postings CSV.
2. **Geography.** 160 countries, weighted towards the US and Europe. India-specific patterns are visible by
   filtering the country to India, but that subset is smaller.
3. **Time window.** One calendar year (2023). Temporal results are quarter-to-quarter or month-to-month
   shifts within that year, not long-run trends, and should not be extrapolated. A sliver of postings dated
   31 Dec 2022 is excluded from period comparisons.
4. **Skill extraction.** Skills were extracted by the publisher through keyword matching against a fixed
   taxonomy of 259 technical tokens. Soft skills, domain knowledge and anything outside the taxonomy are
   absent. A few tokens are ambiguous ("flow", "unity", "planner", "wire", "symphony") and may match
   non-technology wording.
5. **No industry field.** Industry-wise analysis is replaced by role- and country-wise analysis.
6. **Postings without skills.** 117,322 postings (14.9 %) had no extracted skill and were excluded.
7. **Association ≠ causation.** Co-occurrence in postings reflects what employers ask for together. It does
   not show that training in a combination causes employment.
8. **Threshold sensitivity.** Rule sets depend on the chosen thresholds. Defaults (support 1 %, confidence
   30 %, lift 1.2) favour well-evidenced rules, and lowering them surfaces weaker associations.
9. **Relative ranking.** The composite score is min-max scaled over the current surviving rules, so scores
   are comparable within one run, not across runs with different thresholds or scopes.
10. **Curated prerequisites** are a small, hand-maintained list of widely accepted technical dependencies,
    not mined from data.
11. **Mirror source.** The relational files were downloaded from a public GitHub mirror because Hugging Face
    and Kaggle were blocked in the build environment. The record count matches the published figure for the
    original dataset, and SHA-256 checksums pin the exact files used.
