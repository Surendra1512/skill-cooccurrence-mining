"""Page 5 — Temporal Analysis: how skills and combinations shift over time."""

from __future__ import annotations

from dataclasses import replace

import streamlit as st

from dashboard.components import chart, download_csv, page_header
from dashboard.state import DEFAULT_TEMPORAL, AppContext, temporal_result
from src.analytics.skill_frequency import time_frequency
from src.mining.base import MiningError
from src.visualization import charts

FREQUENCIES = {"Quarterly": "Q", "Monthly": "M"}


def render(ctx: AppContext) -> None:
    page_header("Temporal Analysis", "Rules are re-mined in every period with the active thresholds and then tracked.", ctx)
    postings = ctx.postings
    dated = postings["posted_at"].notna().sum()
    if dated == 0:
        st.warning("This dataset has no posting dates, so temporal analysis is not possible.")
        return

    c1, c2, c3 = st.columns(3)
    freq_label = c1.radio("Period", list(FREQUENCIES), horizontal=True, key="ta_freq")
    # Scale the default to the scope: ~2% of dated postings, capped at the configured minimum.
    adaptive_default = int(max(200, min(DEFAULT_TEMPORAL.min_transactions_per_period, dated * 0.02)))
    min_tx = c2.number_input("Minimum postings per period", min_value=200, max_value=50_000,
                             value=adaptive_default, step=100, key=f"ta_min_{adaptive_default}",
                             help="Periods with fewer postings are excluded because their metrics would be unreliable.")
    top_k = c3.slider("Top rules tracked per period", min_value=5, max_value=50, value=DEFAULT_TEMPORAL.top_k_rules, key="ta_topk")
    temporal_cfg = replace(DEFAULT_TEMPORAL, frequency=FREQUENCIES[freq_label], min_transactions_per_period=int(min_tx), top_k_rules=top_k)

    try:
        result = temporal_result(ctx.dataset_id, ctx.scope, ctx.mining_config, temporal_cfg, ctx.weights)
    except MiningError as exc:
        st.error(str(exc))
        return

    for message in result.messages:
        st.info(message, icon=":material/info:")

    summary = result.trend_summary
    counts = summary["trend"].value_counts()
    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Periods analysed", len(result.periods), border=True)
    k2.metric("Rules tracked", len(summary), border=True)
    k3.metric("Emerging", int(counts.get("emerging", 0)), border=True)
    k4.metric("Declining", int(counts.get("declining", 0)), border=True)

    tab_skills, tab_rules, tab_movers, tab_compare = st.tabs(["Skill trends", "Rule trends", "Emerging & declining", "Period comparison"])

    with tab_skills:
        freq = ctx.frequency()
        default = freq.head(5)["skill"].tolist()
        chosen = st.multiselect("Skills (max 8)", freq["skill"].tolist(), default=default, max_selections=8,
                                format_func=lambda s: ctx.labels.get(s, s), key="ta_skills")
        if chosen:
            trend = time_frequency(postings, chosen, FREQUENCIES[freq_label])
            trend = trend[trend["period"].isin(result.periods)]
            trend = trend.assign(label=trend["skill"].map(ctx.labels))
            order = {s: i for i, s in enumerate(chosen)}
            trend = trend.sort_values(by="skill", key=lambda s: s.map(order))
            chart(charts.trend_lines(trend, "period", "share", "label", "Share of postings requiring each skill", "Share of postings"),
                  trend[["period", "label", "postings", "segment_size", "share"]], key="ta_skill_chart")

    with tab_rules:
        metric = st.radio("Metric", ["support", "confidence", "lift"], horizontal=True, key="ta_metric")
        rule_options = summary.sort_values("support_last", ascending=False)["rule"].tolist()
        rules = st.multiselect("Rules (max 8)", rule_options, default=rule_options[:5], max_selections=8, key="ta_rules")
        if rules:
            data = result.rule_trends[result.rule_trends["rule"].isin(rules)]
            order = {r: i for i, r in enumerate(rules)}
            data = data.sort_values(by="rule", key=lambda s: s.map(order))
            fmt = ".2f" if metric == "lift" else ".1%"
            chart(charts.trend_lines(data, "period", metric, "rule", f"Rule {metric} by period", metric.capitalize(), fmt),
                  data[["period", "rule", "support", "confidence", "lift", "support_count"]], key="ta_rule_chart")
        st.markdown("**Top-K rule-set stability** (Jaccard similarity between consecutive periods)")
        st.dataframe(result.stability, hide_index=True, width="stretch",
                     column_config={"jaccard": st.column_config.ProgressColumn("Jaccard", min_value=0.0, max_value=1.0, format="%.2f")})

    with tab_movers:
        st.caption(f"A rule is emerging/declining when its support changes by ≥ {temporal_cfg.trend_min_relative_change:.0%} "
                   f"from {result.periods[0]} to {result.periods[-1]} and the trend across all periods agrees.")
        cols = {
            "rule": "Rule",
            "support_first": st.column_config.NumberColumn(f"Support {result.periods[0]}", format="%.4f"),
            "support_last": st.column_config.NumberColumn(f"Support {result.periods[-1]}", format="%.4f"),
            "support_change": st.column_config.NumberColumn("Relative change", format="percent"),
            "lift_first": st.column_config.NumberColumn(f"Lift {result.periods[0]}", format="%.2f"),
            "lift_last": st.column_config.NumberColumn(f"Lift {result.periods[-1]}", format="%.2f"),
            "periods_in_top_k": st.column_config.NumberColumn("Periods in top-K", format="localized"),
        }
        show = list(cols)
        c1, c2 = st.columns(2)
        with c1:
            st.markdown("**Emerging combinations**")
            emerging = summary[summary["trend"] == "emerging"].sort_values("support_change", ascending=False)
            if emerging.empty:
                st.caption("None in this window.")
            else:
                st.dataframe(emerging[show], hide_index=True, width="stretch", column_config=cols)
        with c2:
            st.markdown("**Declining combinations**")
            declining = summary[summary["trend"] == "declining"].sort_values("support_change")
            if declining.empty:
                st.caption("None in this window.")
            else:
                st.dataframe(declining[show], hide_index=True, width="stretch", column_config=cols)
        download_csv(result.rule_trends, "temporal_rule_trends.csv", "Download period-level rule metrics", key="dl_temporal")

    with tab_compare:
        first, last = result.periods[0], result.periods[-1]
        chart(charts.period_comparison_bar(summary, first, last), key="ta_compare")
        st.markdown("**Top rules in each period**")
        columns = st.columns(min(len(result.periods), 4))
        for column, period in zip(columns * ((len(result.periods) // 4) + 1), result.periods):
            with column:
                st.markdown(f"*{period}* ({int(result.period_sizes[period]):,} postings)")
                st.markdown("\n".join(f"{i}. {rule}" for i, rule in enumerate(result.top_rules_by_period[period][:8], start=1)))
