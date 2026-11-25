"""Page 4 — Skill Combination Explorer: network, heatmap and combinations."""

from __future__ import annotations

import numpy as np
import pandas as pd
import streamlit as st

from dashboard.components import chart, page_header, rules_table, safe_mining
from dashboard.state import AppContext
from src.mining.association_rules import itemset_label
from src.mining.lift_filter import strongest_combinations
from src.visualization import charts


def render(ctx: AppContext) -> None:
    page_header("Skill Combination Explorer", "Explore how skills connect through the surviving association rules.", ctx)
    outcome = safe_mining(ctx)
    ranked = outcome.ranked
    if ranked.empty:
        st.info("No rules survive the current thresholds. Relax them in the sidebar.")
        return

    max_lift = float(ranked["lift"].max())
    floor = st.slider("Additional lift filter for this page", min_value=float(ctx.mining_config.min_lift),
                      max_value=max(float(ctx.mining_config.min_lift) + 0.1, round(max_lift, 1)),
                      value=float(ctx.mining_config.min_lift), step=0.1, key="ce_lift",
                      help="Show only the more strongly associated rules without re-mining.")
    view = ranked[ranked["lift"] >= floor]
    st.caption(f"{len(view):,} rules with lift ≥ {floor:.1f}.")

    tab_net, tab_heat, tab_combo, tab_skill = st.tabs(["Relationship network", "Co-occurrence heatmap",
                                                        "Strongest combinations", "Rules for a skill"])
    with tab_net:
        edges = st.slider("Maximum links", min_value=10, max_value=120, value=50, step=10, key="ce_edges")
        chart(charts.skill_network(view, ctx.frequency(), ctx.labels, max_edges=edges), key="ce_net")
        st.caption("Node size and colour: share of postings requiring the skill. Edge width: lift of the strongest rule "
                   "between the two skills. Hover an edge midpoint for its metrics.")

    with tab_heat:
        c1, c2 = st.columns(2)
        n = c1.slider("Top skills", min_value=8, max_value=30, value=18, key="ce_heat_n")
        metric = c2.radio("Cell value", ["Lift", "Postings together"], horizontal=True, key="ce_metric")
        matrix = _pair_matrix(ctx, n, metric)
        chart(charts.cooccurrence_heatmap(matrix, ctx.labels, metric),
              matrix.rename(index=ctx.labels, columns=ctx.labels).reset_index(names="skill"), key="ce_heat")

    with tab_combo:
        size = st.segmented_control("Combination size", [2, 3, 4, 5], selection_mode="multi", default=[2, 3], key="ce_size")
        combos = strongest_combinations(view, len(view))
        combos = combos[combos["combination"].map(len).isin(size or [2, 3, 4, 5])].head(50)
        st.dataframe(
            combos.assign(combination=combos["combination"].map(lambda s: itemset_label(s, ctx.labels)))[
                ["combination", "rule", "support_count", "support", "confidence", "lift", "score"]
            ],
            hide_index=True, width="stretch", height=520,
            column_config={
                "combination": "Skill combination", "rule": "Strongest direction",
                "support_count": st.column_config.NumberColumn("Postings", format="localized"),
                "support": st.column_config.NumberColumn(format="%.3f"),
                "confidence": st.column_config.NumberColumn(format="%.2f"),
                "lift": st.column_config.NumberColumn(format="%.2f"),
                "score": st.column_config.ProgressColumn(min_value=0.0, max_value=1.0, format="%.3f"),
            },
        )

    with tab_skill:
        skills = sorted({s for a, c in zip(view["antecedents"], view["consequents"]) for s in a | c},
                        key=lambda s: ctx.labels.get(s, s))
        skill = st.selectbox("Skill", skills, format_func=lambda s: ctx.labels.get(s, s), key="ce_skill")
        if skill:
            as_ant = view[view["antecedents"].map(lambda a: skill in a)]
            as_con = view[view["consequents"].map(lambda c: skill in c)]
            c1, c2 = st.columns(2)
            with c1:
                st.markdown(f"**{ctx.labels.get(skill, skill)} leads to…** ({len(as_ant):,} rules)")
                rules_table(as_ant, height=380, key="ce_ant")
            with c2:
                st.markdown(f"**…leads to {ctx.labels.get(skill, skill)}** ({len(as_con):,} rules)")
                rules_table(as_con, height=380, key="ce_con")


def _pair_matrix(ctx: AppContext, n: int, metric: str) -> pd.DataFrame:
    """Pairwise lift or joint-count matrix for the top-``n`` skills."""
    top = ctx.frequency().head(n)["skill"].tolist()
    matrix = ctx.onehot()[top].to_numpy(dtype=np.float32)
    joint = matrix.T @ matrix
    if metric == "Lift":
        total = matrix.shape[0]
        marginal = np.diag(joint) / total
        values = (joint / total) / np.outer(marginal, marginal)
    else:
        values = joint
    return pd.DataFrame(values, index=top, columns=top)
