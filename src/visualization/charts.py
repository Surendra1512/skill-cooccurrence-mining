"""Plotly chart factory.

Every function takes already-computed data frames and returns a Figure;
no chart computes or invents numbers itself. Visual conventions:

* one shared template (system sans, recessive grid, single y-axis);
* magnitude → single-hue blue ramp; identity → fixed categorical slot order
  (colour follows the entity, never its rank);
* hover tooltips on every mark; legends whenever ≥ 2 series are shown.
"""

from __future__ import annotations

from typing import Sequence

import networkx as nx
import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# --------------------------------------------------------------------------- #
# Design tokens (validated reference palette, light mode)
# --------------------------------------------------------------------------- #
SURFACE = "#ffffff"
INK = "#191919"
INK_SECONDARY = "#666666"
GRID = "#e7e7e7"
AXIS = "#c2c2c2"
PRIMARY = "#257de0"
NEUTRAL = "#9c9c9c"
CATEGORICAL: tuple[str, ...] = ("#257de0", "#f47230", "#00b894", "#f2a600", "#ee7fac", "#008a17", "#6a4ce2", "#ec4647")
SEQUENTIAL: list[list[float | str]] = [
    [0.0, "#cce3fd"], [0.25, "#84b9f3"], [0.5, "#338ced"], [0.75, "#1b64be"], [1.0, "#0e3d7e"]
]
FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

_BASE_LAYOUT = dict(
    font=dict(family=FONT, size=13, color=INK),
    paper_bgcolor=SURFACE,
    plot_bgcolor=SURFACE,
    margin=dict(l=8, r=16, t=48, b=8),
    hoverlabel=dict(bgcolor=SURFACE, bordercolor=AXIS, font=dict(family=FONT, color=INK, size=12)),
    xaxis=dict(gridcolor=GRID, linecolor=AXIS, zerolinecolor=AXIS, tickfont=dict(color=INK_SECONDARY), automargin=True),
    yaxis=dict(gridcolor=GRID, linecolor=AXIS, zerolinecolor=AXIS, tickfont=dict(color=INK_SECONDARY), automargin=True),
    legend=dict(orientation="h", yanchor="top", y=-0.18, xanchor="left", x=0, font=dict(color=INK_SECONDARY)),
    barcornerradius=4,
    title=dict(font=dict(size=15, color=INK), x=0, xanchor="left"),
)


def _style(fig: go.Figure, title: str, height: int = 420) -> go.Figure:
    fig.update_layout(**_BASE_LAYOUT, title_text=title, height=height)
    return fig


def color_map(entities: Sequence[str]) -> dict[str, str]:
    """Stable entity → colour assignment (max 8; extra entities share neutral)."""
    return {e: (CATEGORICAL[i] if i < len(CATEGORICAL) else NEUTRAL) for i, e in enumerate(entities)}


def empty_figure(message: str, height: int = 300) -> go.Figure:
    fig = go.Figure()
    fig.add_annotation(text=message, showarrow=False, font=dict(color=INK_SECONDARY, size=14), x=0.5, y=0.5, xref="paper", yref="paper")
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    return _style(fig, "", height)


# --------------------------------------------------------------------------- #
# 1-2. Individual skill frequency
# --------------------------------------------------------------------------- #
def top_skills_bar(freq: pd.DataFrame, title: str = "Top skills by share of postings") -> go.Figure:
    """Horizontal bar of skill share; expects ``label, share, postings``."""
    if freq.empty:
        return empty_figure("No skills in the current selection.")
    data = freq.iloc[::-1]
    fig = go.Figure(
        go.Bar(
            x=data["share"], y=data["label"], orientation="h", marker_color=PRIMARY,
            customdata=data["postings"],
            hovertemplate="<b>%{y}</b><br>%{x:.1%} of postings<br>%{customdata:,} postings<extra></extra>",
        )
    )
    fig.update_xaxes(tickformat=".0%", title_text="Share of postings")
    return _style(fig, title, height=max(320, 22 * len(data) + 90))


def frequency_distribution(freq: pd.DataFrame) -> go.Figure:
    """Rank–frequency curve (log scale) showing the long tail of skills."""
    if freq.empty:
        return empty_figure("No skills in the current selection.")
    fig = go.Figure(
        go.Scatter(
            x=freq["rank"], y=freq["postings"], mode="lines+markers",
            line=dict(color=PRIMARY, width=2), marker=dict(size=8, color=PRIMARY, line=dict(color=SURFACE, width=2)),
            text=freq["label"],
            hovertemplate="<b>%{text}</b><br>Rank %{x}<br>%{y:,} postings<extra></extra>",
        )
    )
    fig.update_yaxes(type="log", title_text="Postings (log scale)")
    fig.update_xaxes(title_text="Skill rank")
    return _style(fig, "Skill frequency distribution (rank vs postings)")


def skills_per_posting_histogram(sizes: pd.Series) -> go.Figure:
    """Distribution of the number of skills per transaction."""
    counts = sizes.value_counts().sort_index()
    fig = go.Figure(
        go.Bar(x=counts.index, y=counts.values, marker_color=PRIMARY,
               hovertemplate="%{x} skills: %{y:,} postings<extra></extra>")
    )
    fig.update_xaxes(title_text="Skills per posting", dtick=1)
    fig.update_yaxes(title_text="Postings")
    return _style(fig, "Transaction size distribution", height=340)


def segment_heatmap(segment: pd.DataFrame, labels: dict[str, str], title: str) -> go.Figure:
    """Segment × skill share heatmap; expects ``segment, skill, share, postings``."""
    if segment.empty:
        return empty_figure("No data for this segmentation.")
    pivot = segment.pivot(index="segment", columns="skill", values="share").fillna(0.0)
    counts = segment.pivot(index="segment", columns="skill", values="postings").reindex_like(pivot).fillna(0)
    order = pivot.mean().sort_values(ascending=False).index
    pivot, counts = pivot[order], counts[order]
    fig = go.Figure(
        go.Heatmap(
            z=pivot.values, x=[labels.get(c, c) for c in pivot.columns], y=pivot.index,
            customdata=counts.values, colorscale=SEQUENTIAL, xgap=2, ygap=2,
            colorbar=dict(title="Share", tickformat=".0%"),
            hovertemplate="<b>%{y}</b> · %{x}<br>%{z:.1%} of postings (%{customdata:,})<extra></extra>",
        )
    )
    return _style(fig, title, height=max(360, 28 * len(pivot) + 140))


# --------------------------------------------------------------------------- #
# 3-5. Rules
# --------------------------------------------------------------------------- #
def rule_ranking_bar(ranked: pd.DataFrame, top_n: int = 15) -> go.Figure:
    """Composite score of the top rules; expects ``rule, score, lift, confidence, support``."""
    if ranked.empty:
        return empty_figure("No rules survive the current thresholds.")
    data = ranked.head(top_n).iloc[::-1]
    fig = go.Figure(
        go.Bar(
            x=data["score"], y=data["rule"], orientation="h", marker_color=PRIMARY,
            customdata=np.stack([data["support"], data["confidence"], data["lift"], data["support_count"]], axis=1),
            hovertemplate="<b>%{y}</b><br>Score %{x:.3f}<br>Support %{customdata[0]:.2%} (%{customdata[3]:,} postings)"
            "<br>Confidence %{customdata[1]:.1%}<br>Lift %{customdata[2]:.2f}<extra></extra>",
        )
    )
    fig.update_xaxes(title_text="Composite score", range=[0, 1])
    return _style(fig, f"Top {len(data)} ranked rules", height=max(360, 26 * len(data) + 100))


def support_confidence_scatter(rules: pd.DataFrame) -> go.Figure:
    """Support vs confidence, coloured by lift (sequential)."""
    if rules.empty:
        return empty_figure("No rules to plot.")
    data = rules.head(5000)
    fig = go.Figure(
        go.Scattergl(
            x=data["support"], y=data["confidence"], mode="markers", text=data["rule"],
            marker=dict(size=8, color=data["lift"], colorscale=SEQUENTIAL, line=dict(color=SURFACE, width=1),
                        colorbar=dict(title="Lift"), opacity=0.85),
            customdata=data["lift"],
            hovertemplate="<b>%{text}</b><br>Support %{x:.2%}<br>Confidence %{y:.1%}<br>Lift %{customdata:.2f}<extra></extra>",
        )
    )
    fig.update_xaxes(type="log", title_text="Support (log scale)", tickformat=".1%")
    fig.update_yaxes(title_text="Confidence", tickformat=".0%")
    note = f" (first 5,000 of {len(rules):,})" if len(rules) > 5000 else ""
    return _style(fig, "Support vs confidence" + note, height=460)


def lift_histogram(all_rules: pd.DataFrame, min_lift: float) -> go.Figure:
    """Lift distribution of all generated rules with the active threshold."""
    if all_rules.empty:
        return empty_figure("No rules generated.")
    fig = go.Figure(
        go.Histogram(x=all_rules["lift"], nbinsx=60, marker_color=PRIMARY, marker_line=dict(color=SURFACE, width=1),
                     hovertemplate="Lift %{x}<br>%{y:,} rules<extra></extra>")
    )
    fig.add_vline(x=1.0, line=dict(color=INK_SECONDARY, dash="dot", width=1.5),
                  annotation_text="Independence (1.0)", annotation_position="top left")
    fig.add_vline(x=min_lift, line=dict(color=INK, width=2),
                  annotation_text=f"Min lift {min_lift:.2f}", annotation_position="top right")
    fig.update_xaxes(title_text="Lift")
    fig.update_yaxes(title_text="Rules")
    return _style(fig, "Lift distribution of generated rules", height=380)


def filter_funnel(stage_counts: dict[str, int]) -> go.Figure:
    """Rule counts remaining after each threshold stage."""
    stages, values = list(stage_counts), list(stage_counts.values())
    fig = go.Figure(
        go.Bar(x=values, y=stages, orientation="h", marker_color=PRIMARY, text=[f"{v:,}" for v in values],
               textposition="outside", cliponaxis=False, textfont=dict(color=INK),
               hovertemplate="%{y}: %{x:,} rules<extra></extra>")
    )
    fig.update_yaxes(autorange="reversed")
    fig.update_xaxes(title_text="Rules remaining")
    return _style(fig, "Rules surviving each filter", height=300)


# --------------------------------------------------------------------------- #
# 6-7. Co-occurrence
# --------------------------------------------------------------------------- #
def cooccurrence_heatmap(matrix: pd.DataFrame, labels: dict[str, str], metric: str) -> go.Figure:
    """Square skill × skill heatmap (lift or joint count); diagonal masked."""
    values = matrix.to_numpy(dtype=float).copy()
    np.fill_diagonal(values, np.nan)
    names = [labels.get(s, s) for s in matrix.index]
    fmt = "%{z:.2f}" if metric == "Lift" else "%{z:,.0f}"
    fig = go.Figure(
        go.Heatmap(z=values, x=names, y=names, colorscale=SEQUENTIAL, xgap=2, ygap=2, colorbar=dict(title=metric),
                   hovertemplate=f"<b>%{{y}}</b> & <b>%{{x}}</b><br>{metric}: {fmt}<extra></extra>")
    )
    fig.update_yaxes(autorange="reversed")
    return _style(fig, f"Skill co-occurrence heatmap ({metric.lower()})", height=max(460, 24 * len(names) + 160))


def _packed_layout(graph: nx.Graph, max_row_width: float = 22.0, gap: float = 1.2) -> dict[str, np.ndarray]:
    """Lay out each connected component separately and shelf-pack them.

    A single spring layout pushes small components to the edges and crushes
    dense clusters together. Here every component gets Kamada–Kawai layout
    scaled to ``√n`` so large clusters receive proportionally more room, then
    components are packed left-to-right in rows (largest first).
    """
    components = sorted(nx.connected_components(graph), key=len, reverse=True)
    position: dict[str, np.ndarray] = {}
    cursor_x, cursor_y, row_height = 0.0, 0.0, 0.0
    for nodes in components:
        sub = graph.subgraph(nodes)
        if len(nodes) == 1:
            local = {next(iter(nodes)): np.zeros(2)}
        else:
            local = nx.kamada_kawai_layout(sub)
        points = np.array(list(local.values()), dtype=float)
        points -= points.mean(axis=0)
        span = float(np.abs(points).max()) or 1.0
        radius = (1.5 if len(nodes) > 8 else 0.9) * np.sqrt(len(nodes))
        points = points / span * radius
        width = 2 * radius
        if cursor_x > 0 and cursor_x + width > max_row_width:
            cursor_x, cursor_y, row_height = 0.0, cursor_y - row_height - gap, 0.0
        centre = np.array([cursor_x + radius, cursor_y - radius])
        for node, point in zip(local, points):
            position[node] = centre + point
        cursor_x += width + gap
        row_height = max(row_height, 2 * radius)
    return position


def skill_network(ranked: pd.DataFrame, freq: pd.DataFrame, labels: dict[str, str], max_edges: int = 60) -> go.Figure:
    """Force-directed network of pairwise rules (edge width ∝ lift)."""
    pairs = ranked[(ranked["antecedent_len"] == 1) & (ranked["consequent_len"] == 1)].head(max_edges * 2)
    if pairs.empty:
        return empty_figure("No single-skill rules survive the thresholds — relax them to see the network.")
    graph = nx.Graph()
    for row in pairs.itertuples():
        a, c = next(iter(row.antecedents)), next(iter(row.consequents))
        if graph.has_edge(a, c):
            continue
        graph.add_edge(a, c, lift=row.lift, confidence=row.confidence, support=row.support)
        if graph.number_of_edges() >= max_edges:
            break
    position = _packed_layout(graph)
    share = freq.set_index("skill")["share"].to_dict()

    lifts = np.array([d["lift"] for *_, d in graph.edges(data=True)])
    lo, hi = float(lifts.min()), float(lifts.max())
    fig = go.Figure()
    for a, c, d in graph.edges(data=True):
        width = 1 + 5 * ((d["lift"] - lo) / (hi - lo) if hi > lo else 0.5)
        fig.add_trace(go.Scatter(x=[position[a][0], position[c][0]], y=[position[a][1], position[c][1]], mode="lines",
                                 line=dict(width=width, color="rgba(37,125,224,0.35)"), hoverinfo="skip", showlegend=False))
    mid_x = [(position[a][0] + position[c][0]) / 2 for a, c in graph.edges()]
    mid_y = [(position[a][1] + position[c][1]) / 2 for a, c in graph.edges()]
    edge_text = [f"<b>{labels.get(a, a)} — {labels.get(c, c)}</b><br>Lift {d['lift']:.2f}<br>Support {d['support']:.2%}"
                 for a, c, d in graph.edges(data=True)]
    fig.add_trace(go.Scatter(x=mid_x, y=mid_y, mode="markers", marker=dict(size=14, opacity=0), text=edge_text,
                             hovertemplate="%{text}<extra></extra>", showlegend=False))
    nodes = list(graph.nodes())
    node_share = np.array([share.get(n, 0.0) for n in nodes])
    fig.add_trace(
        go.Scatter(
            x=[position[n][0] for n in nodes], y=[position[n][1] for n in nodes], mode="markers+text",
            text=[labels.get(n, n) for n in nodes], textposition="top center", textfont=dict(size=11, color=INK),
            marker=dict(size=12 + 40 * np.sqrt(node_share / max(node_share.max(), 1e-9)), color=node_share,
                        colorscale=SEQUENTIAL, line=dict(color=SURFACE, width=2), colorbar=dict(title="Share", tickformat=".0%")),
            customdata=np.stack([node_share, [graph.degree(n) for n in nodes]], axis=1),
            hovertemplate="<b>%{text}</b><br>%{customdata[0]:.1%} of postings<br>%{customdata[1]} strong links<extra></extra>",
            showlegend=False,
        )
    )
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    fig.update_yaxes(scaleanchor="x", scaleratio=1)
    return _style(fig, f"Skill relationship network ({graph.number_of_edges()} strongest pairwise links)", height=720)


# --------------------------------------------------------------------------- #
# 8-9. Temporal
# --------------------------------------------------------------------------- #
def trend_lines(long: pd.DataFrame, x: str, y: str, series: str, title: str, y_title: str, y_format: str = ".1%") -> go.Figure:
    """Multi-series line chart (≤ 8 series, fixed colour order)."""
    if long.empty:
        return empty_figure("No trend data.")
    entities = list(dict.fromkeys(long[series]))[: len(CATEGORICAL)]
    colors = color_map(entities)
    fig = go.Figure()
    for entity in entities:
        data = long[long[series] == entity].sort_values(x)
        fig.add_trace(
            go.Scatter(x=data[x], y=data[y], name=entity, mode="lines+markers",
                       line=dict(color=colors[entity], width=2), marker=dict(size=8, line=dict(color=SURFACE, width=2)),
                       hovertemplate=f"<b>{entity}</b><br>%{{x}}: %{{y:{y_format}}}<extra></extra>")
        )
    fig.update_yaxes(title_text=y_title, tickformat=y_format)
    fig.update_layout(hovermode="x unified")
    return _style(fig, title, height=440)


def period_comparison_bar(summary: pd.DataFrame, first: str, last: str, top_n: int = 12) -> go.Figure:
    """Support in first vs last period for the biggest movers."""
    if summary.empty:
        return empty_figure("No tracked rules.")
    movers = summary.reindex(summary["support_change"].abs().sort_values(ascending=False).index).head(top_n).iloc[::-1]
    fig = go.Figure()
    for column, name, color in (("support_first", first, CATEGORICAL[0]), ("support_last", last, CATEGORICAL[1])):
        fig.add_trace(go.Bar(x=movers[column], y=movers["rule"], name=name, orientation="h", marker_color=color,
                             hovertemplate=f"<b>%{{y}}</b><br>{name}: %{{x:.2%}}<extra></extra>"))
    fig.update_layout(barmode="group", bargap=0.25, bargroupgap=0.1)
    fig.update_xaxes(title_text="Support", tickformat=".1%")
    return _style(fig, f"Largest support shifts: {first} vs {last}", height=max(380, 40 * len(movers) + 120))


# --------------------------------------------------------------------------- #
# 10. Training combinations
# --------------------------------------------------------------------------- #
def recommendation_comparison(recs: pd.DataFrame) -> go.Figure:
    """Side-by-side confidence and lift for recommended skills (separate axes)."""
    if recs.empty:
        return empty_figure("No recommendations for the current selection.")
    data = recs.iloc[::-1]
    fig = make_subplots(rows=1, cols=2, shared_yaxes=True, horizontal_spacing=0.06,
                        subplot_titles=("Confidence", "Lift"))
    fig.add_trace(go.Bar(x=data["confidence"], y=data["label"], orientation="h", marker_color=CATEGORICAL[0], showlegend=False,
                         customdata=data["support_count"],
                         hovertemplate="<b>%{y}</b><br>Confidence %{x:.1%}<br>%{customdata:,} postings<extra></extra>"), 1, 1)
    fig.add_trace(go.Bar(x=data["lift"], y=data["label"], orientation="h", marker_color=CATEGORICAL[0], showlegend=False,
                         hovertemplate="<b>%{y}</b><br>Lift %{x:.2f}<extra></extra>"), 1, 2)
    fig.update_xaxes(tickformat=".0%", row=1, col=1)
    fig.add_vline(x=1.0, line=dict(color=INK_SECONDARY, dash="dot", width=1.5), row=1, col=2)
    fig.update_layout(bargap=0.45 if len(data) < 4 else 0.3)
    styled = _style(fig, "Complementary skill comparison", height=max(240, 38 * len(data) + 130))
    styled.update_annotations(font=dict(color=INK_SECONDARY, size=13))
    return styled


def role_share_bar(roles: pd.DataFrame) -> go.Figure:
    """Roles of postings that require the full programme combination."""
    if roles.empty:
        return empty_figure("No roles found.")
    data = roles.iloc[::-1]
    fig = go.Figure(
        go.Bar(x=data["share"], y=data["role"], orientation="h", marker_color=PRIMARY,
               customdata=np.stack([data["postings"], data["lift_vs_overall"]], axis=1),
               hovertemplate="<b>%{y}</b><br>%{x:.1%} of matching postings (%{customdata[0]:,})"
               "<br>%{customdata[1]:.2f}× its overall share<extra></extra>")
    )
    fig.update_xaxes(tickformat=".0%", title_text="Share of postings requiring the combination")
    return _style(fig, "Target roles for this combination", height=max(280, 34 * len(data) + 110))


def algorithm_timing_bar(runs: pd.DataFrame) -> go.Figure:
    """Execution time per algorithm."""
    fig = go.Figure(
        go.Bar(x=runs["algorithm"], y=runs["seconds"], marker_color=PRIMARY, text=[f"{s:.2f}s" for s in runs["seconds"]],
               textposition="outside", cliponaxis=False, textfont=dict(color=INK),
               hovertemplate="%{x}: %{y:.2f} s<extra></extra>")
    )
    fig.update_yaxes(title_text="Seconds")
    return _style(fig, "Execution time (identical input and thresholds)", height=320)
