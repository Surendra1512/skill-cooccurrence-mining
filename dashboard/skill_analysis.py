"""Page 2 — Skill Analysis: the individual-frequency baseline."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from dashboard.components import chart, download_csv, page_header
from dashboard.state import AppContext
from src.analytics.skill_frequency import baseline_vs_association, segment_frequency
from src.visualization import charts


def render(ctx: AppContext) -> None:
    page_header("Skill Analysis", "Baseline: how often each individual skill is requested.", ctx)
    freq = ctx.frequency()
    postings = ctx.postings

    tab_freq, tab_segments, tab_explorer, tab_baseline, tab_trace = st.tabs(
        ["Frequency", "By role & country", "Skill explorer", "Baseline vs association", "Cleaned skills"]
    )

    with tab_freq:
        top_n = st.segmented_control("Show top", [10, 20, 30], default=20, key="sa_topn") or 20
        top = freq.head(top_n)
        chart(charts.top_skills_bar(top, f"Top {top_n} individual skills"), top[["rank", "label", "postings", "share"]], key="sa_top")
        col1, col2 = st.columns(2)
        with col1:
            chart(charts.frequency_distribution(freq), key="sa_dist")
        with col2:
            chart(charts.skills_per_posting_histogram(postings["skills"].map(len)), key="sa_hist")
        download_csv(freq[["rank", "skill", "label", "postings", "share"]], "skill_frequency.csv",
                     "Download full frequency table", key="dl_freq")

    with tab_segments:
        st.caption("The dataset has no industry field; job role and country are the available segment dimensions.")
        dimension = st.radio("Segment by", ["Job role", "Country"], horizontal=True, key="sa_dim")
        column = "role" if dimension == "Job role" else "country"
        top_segments = postings[column].value_counts().head(12).index
        subset = postings[postings[column].isin(top_segments)]
        segment = segment_frequency(subset, column, skills=freq.head(15)["skill"].tolist())
        chart(charts.segment_heatmap(segment, ctx.labels, f"Share of postings requiring each top skill, by {dimension.lower()}"),
              segment.assign(skill=segment["skill"].map(ctx.labels)), key="sa_seg")

    with tab_explorer:
        _skill_explorer(ctx, freq)

    with tab_baseline:
        _baseline_comparison(ctx, freq)

    with tab_trace:
        st.markdown("Every raw skill string from the source and the canonical skill it was normalised to.")
        trace = ctx.dataset.trace
        status = st.multiselect("Status", sorted(trace["status"].unique()), placeholder="All statuses", key="sa_status")
        shown = trace[trace["status"].isin(status)] if status else trace
        st.dataframe(shown, hide_index=True, width="stretch", height=420,
                     column_config={"occurrences": st.column_config.NumberColumn("Occurrences", format="localized")})
        st.markdown("**Skill catalogue** (canonical skills, categories and the raw variants merged into each)")
        st.dataframe(ctx.catalog, hide_index=True, width="stretch", height=360,
                     column_config={"share": st.column_config.NumberColumn("Share", format="%.4f")})


def _skill_explorer(ctx: AppContext, freq: pd.DataFrame) -> None:
    options = freq["skill"].tolist()
    skill = st.selectbox("Search a skill", options, format_func=lambda s: ctx.labels.get(s, s), key="sa_skill",
                         help="Type to search.")
    if not skill:
        return
    row = freq.set_index("skill").loc[skill]
    catalog_row = ctx.catalog.set_index("skill").loc[skill] if skill in set(ctx.catalog["skill"]) else None
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Postings", f"{int(row['postings']):,}", border=True)
    c2.metric("Share of postings", f"{row['share']:.2%}", border=True)
    c3.metric("Frequency rank", f"#{int(row['rank'])}", border=True)
    c4.metric("Category", catalog_row["category"] if catalog_row is not None else "—", border=True)
    if catalog_row is not None:
        st.caption(f"Raw variants merged: {catalog_row['raw_variants']}")

    onehot = ctx.onehot()
    has_skill = onehot[skill].to_numpy()
    n, n_skill = len(onehot), int(has_skill.sum())
    joint = onehot.loc[has_skill].sum(axis=0)
    marginal = onehot.sum(axis=0)
    table = pd.DataFrame({"skill": onehot.columns, "postings_together": joint.values, "marginal": marginal.values})
    table = table[(table["skill"] != skill) & (table["postings_together"] > 0)]
    table["confidence"] = table["postings_together"] / n_skill
    table["lift"] = table["confidence"] / (table["marginal"] / n)
    table["label"] = table["skill"].map(lambda s: ctx.labels.get(s, s))
    st.markdown(f"**Skills most often requested alongside {ctx.labels.get(skill, skill)}**")
    sort = st.radio("Order by", ["Postings together", "Lift (min 100 postings)"], horizontal=True, key="sa_sort")
    if sort.startswith("Lift"):
        table = table[table["postings_together"] >= 100].sort_values("lift", ascending=False)
    else:
        table = table.sort_values("postings_together", ascending=False)
    st.dataframe(
        table.head(20)[["label", "postings_together", "confidence", "lift"]], hide_index=True, width="stretch",
        column_config={
            "label": "Skill",
            "postings_together": st.column_config.NumberColumn("Postings together", format="localized"),
            "confidence": st.column_config.NumberColumn(f"P(skill | {ctx.labels.get(skill, skill)})", format="%.3f"),
            "lift": st.column_config.NumberColumn("Lift", format="%.2f"),
        },
    )


def _baseline_comparison(ctx: AppContext, freq: pd.DataFrame) -> None:
    st.markdown(
        """
**Why frequency alone is not enough.** A frequency-only planner would bundle the most requested skills.
But two popular skills can appear together *no more often than chance* — their pairing says nothing
about how employers combine them. Association mining compares the observed co-occurrence with what
independence would predict (lift), and surfaces combinations that frequency ranking would miss
entirely because the skills themselves are less common.
"""
    )
    top_n = st.slider("Number of top skills to pair", min_value=5, max_value=20, value=10, key="sa_pairs")
    pairs = baseline_vs_association(ctx.postings["skills"].tolist(), freq, top_n)
    pairs = pairs.assign(skill_a=pairs["skill_a"].map(ctx.labels), skill_b=pairs["skill_b"].map(ctx.labels))
    near_independent = int((pairs["lift"].between(0.9, 1.1)).sum())
    st.info(f"Of the {len(pairs)} pairs formed from the {top_n} most frequent skills, **{near_independent}** have lift "
            "between 0.9 and 1.1 — frequent, but essentially independent of each other.", icon=":material/insights:")
    st.dataframe(
        pairs, hide_index=True, width="stretch", height=380,
        column_config={
            "skill_a": "Skill A", "skill_b": "Skill B",
            "baseline_score": st.column_config.NumberColumn("Baseline score (share A + share B)", format="%.3f"),
            "expected_support": st.column_config.NumberColumn("Expected support if independent", format="%.4f"),
            "observed_support": st.column_config.NumberColumn("Observed support", format="%.4f"),
            "lift": st.column_config.NumberColumn("Lift", format="%.2f"),
            "postings_together": st.column_config.NumberColumn("Postings together", format="localized"),
        },
    )
    outcome = ctx.mining()
    if not outcome.ranked.empty:
        top_freq = set(freq.head(top_n)["skill"])
        top_rules = outcome.ranked.head(50)
        outside = top_rules[[not ((a | c) <= top_freq) for a, c in zip(top_rules["antecedents"], top_rules["consequents"])]]
        share = len(outside) / len(top_rules)
        st.markdown(
            f"Of the **top {len(top_rules)} ranked association rules**, **{len(outside)} ({share:.0%})** involve at least "
            f"one skill outside the {top_n} most frequent — combinations a frequency-only view would not surface."
        )
        st.dataframe(outside.head(10)[["rule", "support_count", "confidence", "lift"]], hide_index=True, width="stretch",
                     column_config={"support_count": st.column_config.NumberColumn("Postings", format="localized"),
                                    "confidence": st.column_config.NumberColumn(format="%.2f"),
                                    "lift": st.column_config.NumberColumn(format="%.2f")})
