"""Page 3 — Association Rule Mining: configuration, ranked rules, evaluation."""

from __future__ import annotations

import numpy as np
import pandas as pd
import streamlit as st

from config.settings import RankingWeights
from dashboard.components import (
    chart,
    download_csv,
    export_rules_frame,
    kpi_row,
    metric_glossary,
    page_header,
    rules_table,
    safe_mining,
)
from dashboard.state import AppContext, algorithm_comparison
from src.mining.lift_filter import lift_interpretation
from src.recommendations.training_recommender import explain_rule
from src.visualization import charts


def render(ctx: AppContext) -> None:
    page_header(
        "Association Rule Mining",
        "Adjust the algorithm and thresholds in the sidebar, then press Generate rules.",
        ctx,
    )
    outcome = safe_mining(ctx)
    cfg = ctx.mining_config
    ranked = outcome.ranked

    kpi_row(
        [
            ("Algorithm", cfg.algorithm, None),
            ("Mining time", f"{outcome.itemsets.seconds:.2f} s", "Frequent-itemset mining time for this run (cached afterwards)."),
            ("Frequent itemsets", f"{len(outcome.itemsets.itemsets):,}", None),
            ("Rules generated", f"{len(outcome.all_rules):,}", "All rules derivable from the frequent itemsets."),
            ("Rules surviving", f"{len(ranked):,}", "After support, confidence and lift thresholds."),
        ]
    )
    metric_glossary()

    tab_rules, tab_charts, tab_explain, tab_eval = st.tabs(
        ["Ranked rules", "Rule charts", "Explain a rule", "Apriori vs FP-Growth"]
    )

    with tab_rules:
        _ranked_rules(ctx, ranked)

    with tab_charts:
        col1, col2 = st.columns(2)
        with col1:
            chart(charts.filter_funnel(outcome.filtered.stage_counts), key="am_funnel")
        with col2:
            chart(charts.lift_histogram(outcome.all_rules, cfg.min_lift), key="am_lift")
        chart(charts.rule_ranking_bar(ranked, 15), ranked.head(15)[["rank", "rule", "score", "support", "confidence", "lift"]], key="am_rank")
        chart(charts.support_confidence_scatter(ranked), key="am_scatter")

    with tab_explain:
        if ranked.empty:
            st.info("No surviving rules to explain.")
        else:
            choice = st.selectbox("Rule", ranked.head(300).index, format_func=lambda i: f"#{ranked.at[i, 'rank']} · {ranked.at[i, 'rule']}",
                                  key="am_explain")
            row = ranked.loc[choice]
            st.markdown(f"### {row['rule']}")
            st.write(explain_rule(row, ctx.labels))
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Support", f"{row['support']:.2%}", help=f"{int(row['support_count']):,} postings contain all skills.", border=True)
            c2.metric("Confidence", f"{row['confidence']:.1%}", border=True)
            c3.metric("Lift", f"{row['lift']:.2f}", border=True)
            c4.metric("Composite score", f"{row['score']:.3f}", border=True)
            st.markdown(
                f"- **Lift interpretation:** {lift_interpretation(row['lift'])}.\n"
                f"- **Antecedent support:** {row['antecedent_support']:.2%} of postings require {row['antecedent']}.\n"
                f"- **Consequent support:** {row['consequent_support']:.2%} of postings require {row['consequent']}.\n"
                f"- **Leverage:** {row['leverage']:.4f} (observed minus expected joint support)."
            )
            _score_breakdown(ranked, row, ctx.weights)

    with tab_eval:
        st.markdown("Both algorithms receive the **same one-hot matrix and thresholds**. Identical outputs confirm "
                    "correctness; the difference is speed.")
        if st.button("Run comparison", type="primary", icon=":material/compare_arrows:", key="am_compare"):
            st.session_state["am_compare_ready"] = True
        if st.session_state.get("am_compare_ready"):
            comparison = algorithm_comparison(ctx.dataset_id, ctx.scope, cfg)
            runs = comparison.as_frame()
            c1, c2 = st.columns([1, 1])
            with c1:
                st.dataframe(runs, hide_index=True, width="stretch",
                             column_config={"seconds": st.column_config.NumberColumn("Seconds", format="%.2f")})
                st.markdown(
                    f"- Identical frequent itemsets: **{'Yes' if comparison.identical_itemsets else 'No'}** "
                    f"(Jaccard {comparison.itemset_jaccard:.4f})\n"
                    f"- Max support difference: **{comparison.max_support_difference:.2e}**\n"
                    f"- Identical surviving rules: **{'Yes' if comparison.identical_surviving_rules else 'No'}**"
                )
            with c2:
                chart(charts.algorithm_timing_bar(runs), key="am_timing")


def _ranked_rules(ctx: AppContext, ranked: pd.DataFrame) -> None:
    if ranked.empty:
        st.info("No rules survive the current thresholds. Lower minimum support, confidence or lift.")
        return
    c1, c2, c3 = st.columns([2, 1, 1])
    skills = sorted({s for a, c in zip(ranked["antecedents"], ranked["consequents"]) for s in a | c},
                    key=lambda s: ctx.labels.get(s, s))
    contains = c1.multiselect("Rules involving skill(s)", skills, format_func=lambda s: ctx.labels.get(s, s), key="am_contains")
    ant_len = c2.multiselect("Antecedent size", sorted(ranked["antecedent_len"].unique()), key="am_alen")
    con_len = c3.multiselect("Consequent size", sorted(ranked["consequent_len"].unique()), key="am_clen")

    shown = ranked
    if contains:
        wanted = set(contains)
        shown = shown[[bool(wanted & (a | c)) for a, c in zip(shown["antecedents"], shown["consequents"])]]
    if ant_len:
        shown = shown[shown["antecedent_len"].isin(ant_len)]
    if con_len:
        shown = shown[shown["consequent_len"].isin(con_len)]
    st.caption(f"{len(shown):,} of {len(ranked):,} surviving rules shown.")
    rules_table(shown, height=520, key="am_table")
    d1, d2 = st.columns(2)
    with d1:
        download_csv(export_rules_frame(shown), "association_rules.csv", "Download shown rules (CSV)", key="dl_rules")
    with d2:
        itemsets = ctx.mining().itemsets.itemsets
        export = itemsets.assign(itemset=itemsets["itemsets"].map(lambda s: " + ".join(sorted(ctx.labels.get(i, i) for i in s))))
        download_csv(export[["itemset", "length", "support", "support_count"]], "frequent_itemsets.csv",
                     "Download frequent itemsets (CSV)", key="dl_itemsets")


def _score_breakdown(ranked: pd.DataFrame, row: pd.Series, weights: RankingWeights) -> None:
    w_lift, w_conf, w_sup = weights.normalised()

    def scaled(series: pd.Series, value: float) -> float:
        lo, hi = float(series.min()), float(series.max())
        return 1.0 if hi - lo < 1e-12 else (value - lo) / (hi - lo)

    lift_c = scaled(np.log2(ranked["lift"]), float(np.log2(row["lift"])))
    conf_c = scaled(ranked["confidence"], float(row["confidence"]))
    sup_c = scaled(np.log10(ranked["support"]), float(np.log10(row["support"])))
    st.markdown("**Score breakdown** (components scaled 0–1 across surviving rules)")
    st.dataframe(
        pd.DataFrame(
            {
                "component": ["log₂ lift", "confidence", "log₁₀ support"],
                "scaled value": [lift_c, conf_c, sup_c],
                "weight": [w_lift, w_conf, w_sup],
                "contribution": [w_lift * lift_c, w_conf * conf_c, w_sup * sup_c],
            }
        ),
        hide_index=True, width="stretch",
        column_config={c: st.column_config.NumberColumn(format="%.3f") for c in ["scaled value", "weight", "contribution"]},
    )
