# Limitations

1. **Sector coverage.** The verified public dataset covers data and technology roles (analysts, engineers,
   scientists, software, ML and cloud engineers). It does not represent cooperative-sector, agricultural,
   dairy, rural-finance or blue-collar vacancies. No public per-posting dataset of Indian cooperative-sector
   vacancies with skill lists could be found. The method is domain-independent: any organisation can upload
   its own postings CSV on the *Data and methodology* page and run the full analysis in the browser.
2. **Country labels.** The source's country field is partly unreliable. The 21,519 raw postings labelled
   *Sudan* are mostly US jobs (Dallas, Austin, "Anywhere") labelled with the collector's search location.
   Country breakdowns are illustrative.
3. **Time window.** One calendar year (2023). Temporal results are quarter-to-quarter shifts within that
   year, not long-run trends. The 1,596 postings dated 31 December 2022 form a period that is too small and
   is excluded from period comparisons.
4. **Skill extraction.** The publisher extracted skills by keyword matching against 259 technical terms.
   Soft skills and other terms are absent, and a few tokens (*flow*, *unity*, *planner*) can match
   non-technical wording. 117,322 postings (14.9 %) had no extracted skill and were excluded.
5. **No industry field.** Industry-wise analysis is replaced by role and country breakdowns.
6. **Association is not causation.** A rule A → B describes co-occurrence in postings. It does not show that
   learning A leads to needing B, or that a programme leads to employment.
7. **Thresholds and ranking.** Results depend on the chosen thresholds and weights. Scores are min-max scaled
   within one run, so they are comparable only within that run. No statistical significance test is applied.
8. **Curated components.** The synonym dictionary and the prerequisite list are maintained by hand.
9. **Browser execution.** Mining runs on the visitor's device. Very low support thresholds on the full dataset
   can take longer on slow devices; a safety limit of 60,000 frequent itemsets stops runaway runs.
10. **Mirror source.** The relational files were downloaded from a public GitHub mirror of the original
    dataset; the record count matches the published figure and SHA-256 checksums pin the exact files.
