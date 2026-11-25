"""Page 1 — Overview: headline KPIs, top skills and strongest combinations."""

from __future__ import annotations

import streamlit as st

from dashboard.components import chart, kpi_row, page_header, safe_mining
from dashboard.state import AppContext
from src.mining.association_rules import itemset_label
from src.mining.lift_filter import strongest_combinations
from src.visualization import charts


def render(ctx: AppContext) -> None:
    page_header(
        "Skill Co-Occurrence Mining",
        "Which skills do employers genuinely request together, and which combined training programmes follow from that?",
        ctx,
    )
    report = ctx.dataset.report
    outcome = safe_mining(ctx)
    postings = ctx.postings

    kpi_row(
        [
            ("Job postings (raw)", f"{report['original_records']:,}", "Records in the source dataset before cleaning."),
            ("Transactions", f"{len(postings):,}", "Cleaned postings with ≥1 skill in the current scope."),
            ("Unique skills", f"{len({s for skills in postings['skills'] for s in skills}):,}", "Canonical skills after normalisation."),
            ("Frequent itemsets", f"{len(outcome.itemsets.itemsets):,}", f"Skill sets with support ≥ {ctx.mining_config.min_support:.3f}."),
            ("Surviving rules", f"{len(outcome.ranked):,}", "Rules passing support, confidence and lift thresholds."),
        ]
    )

    st.markdown(
        "**Pipeline:** real job postings → preprocessing & skill normalisation → skill transactions → "
        f"{ctx.mining_config.algorithm} mining → lift-based filtering → ranked skill combinations → training planning."
    )

    left, right = st.columns([1, 1.25], gap="large")
    with left:
        top = ctx.frequency().head(15)
        chart(charts.top_skills_bar(top, "Most requested skills (baseline)"),
              top[["rank", "label", "postings", "share"]], key="ov_top")
    with right:
        st.subheader("Strongest skill combinations")
        combos = strongest_combinations(outcome.ranked, 12)
        if combos.empty:
            st.info("No rules survive the current thresholds. Relax them in the sidebar.")
        else:
            table = combos.assign(
                combination=combos["combination"].map(lambda s: itemset_label(s, ctx.labels)),
                best_rule=combos["rule"],
            )[["combination", "best_rule", "support_count", "confidence", "lift", "score"]]
            st.dataframe(
                table, hide_index=True, width="stretch", height=460,
                column_config={
                    "combination": "Skill combination",
                    "best_rule": "Strongest direction",
                    "support_count": st.column_config.NumberColumn("Postings", format="localized"),
                    "confidence": st.column_config.NumberColumn("Confidence", format="%.2f"),
                    "lift": st.column_config.NumberColumn("Lift", format="%.2f"),
                    "score": st.column_config.ProgressColumn("Score", min_value=0.0, max_value=1.0, format="%.3f"),
                },
            )

    with st.expander("Preprocessing summary", icon=":material/cleaning_services:"):
        kpi_row(
            [
                ("Duplicates removed", f"{report['duplicate_records_removed']:,}", None),
                ("Postings without skills", f"{report['postings_without_skills_removed']:,}", None),
                ("Synonyms merged", f"{report['synonym_variants_merged']:,}", None),
                ("Avg skills / posting", f"{report['avg_skills_per_transaction']}", None),
            ]
        )
        st.caption(f"Posting dates: {report['date_min'][:10] if report['date_min'] else 'n/a'} to "
                   f"{report['date_max'][:10] if report['date_max'] else 'n/a'}. Full details on the Dataset & Methodology page.")
