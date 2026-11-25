"""Reusable Streamlit UI building blocks."""

from __future__ import annotations

import io
import json
from typing import Any, Sequence

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from dashboard.state import AppContext
from src.mining.base import MiningError

PLOTLY_CONFIG: dict[str, Any] = {"displaylogo": False, "responsive": True,
                                 "toImageButtonOptions": {"format": "png", "scale": 2}}

RULE_DISPLAY_COLUMNS: dict[str, Any] = {
    "rank": st.column_config.NumberColumn("Rank", format="localized", width="small"),
    "antecedent": st.column_config.TextColumn("If a posting requires…"),
    "consequent": st.column_config.TextColumn("…it also tends to require"),
    "support": st.column_config.NumberColumn("Support", format="%.3f", help="Share of all postings containing every skill of the rule."),
    "confidence": st.column_config.NumberColumn("Confidence", format="%.3f", help="Share of postings with the antecedent that also contain the consequent."),
    "lift": st.column_config.NumberColumn("Lift", format="%.2f", help="Confidence ÷ consequent support. >1 means together more often than chance."),
    "support_count": st.column_config.NumberColumn("Postings", format="localized", help="Number of postings containing every skill of the rule."),
    "score": st.column_config.ProgressColumn("Score", min_value=0.0, max_value=1.0, format="%.3f"),
}


def page_header(title: str, subtitle: str, ctx: AppContext | None = None) -> None:
    st.title(title)
    st.caption(subtitle)
    if ctx is not None:
        st.caption(f"Dataset: **{ctx.dataset_label}** · Scope: {ctx.scope_description()} · "
                   f"{len(ctx.postings):,} transactions")


def kpi_row(items: Sequence[tuple[str, str, str | None]]) -> None:
    """Row of bordered metric cards: (label, value, help)."""
    columns = st.columns(len(items))
    for column, (label, value, help_text) in zip(columns, items):
        column.metric(label, value, help=help_text, border=True)


def chart(fig: go.Figure, data: pd.DataFrame | None = None, key: str | None = None) -> None:
    """Render a Plotly figure with an accessible tabular view of its data."""
    st.plotly_chart(fig, width="stretch", config=PLOTLY_CONFIG, key=key)
    if data is not None and not data.empty:
        with st.expander("View data table"):
            st.dataframe(data, width="stretch", hide_index=True)


def rules_table(rules: pd.DataFrame, height: int = 420, key: str | None = None) -> None:
    columns = [c for c in RULE_DISPLAY_COLUMNS if c in rules.columns]
    st.dataframe(rules[columns], column_config=RULE_DISPLAY_COLUMNS, hide_index=True,
                 width="stretch", height=height, key=key)


def export_rules_frame(rules: pd.DataFrame) -> pd.DataFrame:
    """Flatten frozensets so rules export cleanly to CSV."""
    keep = ["rank", "antecedent", "consequent", "support", "confidence", "lift", "leverage", "conviction",
            "support_count", "antecedent_support", "consequent_support", "antecedent_len", "consequent_len", "score"]
    return rules[[c for c in keep if c in rules.columns]]


def download_csv(frame: pd.DataFrame, file_name: str, label: str, key: str) -> None:
    buffer = io.StringIO()
    frame.to_csv(buffer, index=False)
    st.download_button(label, buffer.getvalue().encode("utf-8"), file_name=file_name, mime="text/csv",
                       key=key, disabled=frame.empty, icon=":material/download:")


def download_json(payload: Any, file_name: str, label: str, key: str) -> None:
    st.download_button(label, json.dumps(payload, indent=2, default=str).encode("utf-8"), file_name=file_name,
                       mime="application/json", key=key, icon=":material/download:")


def safe_mining(ctx: AppContext):
    """Run (cached) mining and render a clear error instead of a traceback."""
    try:
        return ctx.mining()
    except MiningError as exc:
        st.error(f"Mining could not run: {exc}", icon=":material/error:")
        st.stop()


def metric_glossary() -> None:
    with st.expander("How to read support, confidence and lift", icon=":material/help:"):
        st.markdown(
            """
For a rule **A → B** over *N* postings:

| Metric | Formula | Meaning |
|---|---|---|
| **Support** | P(A ∪ B) = postings with all of A and B ÷ N | How common the combination is. Low support = niche evidence. |
| **Confidence** | P(A ∪ B) ÷ P(A) | Of postings requiring A, the share that also require B. |
| **Lift** | Confidence ÷ P(B) | How much more likely B is given A than in general. **>1** positive association, **=1** independence, **<1** negative association. |

High lift alone is not enough: a rule seen in a handful of postings can have huge lift by chance.
Rules are therefore filtered on **all three** thresholds and ranked with a composite score.
"""
        )
