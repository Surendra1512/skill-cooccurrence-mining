"""Skill Co-Occurrence Mining for Cooperative Employment Planning (SIH26087).

Run with::

    streamlit run app.py
"""

from __future__ import annotations

import streamlit as st

from config.settings import ALGORITHMS, SETTINGS, MiningConfig, RankingWeights
from dashboard import (
    association_mining,
    combination_explorer,
    methodology,
    overview,
    skill_analysis,
    temporal_analysis,
    training_planner,
)
from dashboard.state import (
    REFERENCE_ID,
    AppContext,
    available_datasets,
    build_reference_dataset,
    get_dataset,
)
from src.data_collection.dataset_loader import DatasetError

st.set_page_config(
    page_title="Skill Co-Occurrence Mining · SIH26087",
    page_icon=":material/hub:",
    layout="wide",
    initial_sidebar_state="auto",
)

st.markdown(
    """
<style>
  .block-container { padding-top: 2rem; max-width: 1400px; }
  [data-testid="stMetricValue"] { font-size: 1.6rem; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
""",
    unsafe_allow_html=True,
)


def _onboarding() -> None:
    """Shown when no processed dataset exists yet."""
    st.title("Skill Co-Occurrence Mining")
    st.info(
        "No processed dataset was found. Build it from the verified public source "
        "(downloads ~67 MB into `data/raw/`, verifies SHA-256 checksums, then preprocesses).",
        icon=":material/database:",
    )
    if st.button("Download and build dataset", type="primary", icon=":material/download:"):
        with st.spinner("Downloading, verifying and preprocessing… this takes about a minute."):
            try:
                build_reference_dataset()
            except DatasetError as exc:
                st.error(str(exc))
                st.stop()
        st.rerun()
    st.caption("Alternatively run `python -m scripts.build_dataset` in a terminal, or upload your own "
               "postings CSV from the Dataset & Methodology page once a dataset is loaded.")


def _sidebar() -> AppContext | None:
    datasets = available_datasets()
    if not datasets:
        return None

    with st.sidebar:
        st.header("Data")
        dataset_ids = list(datasets)
        default = st.session_state.get("dataset_id", REFERENCE_ID)
        dataset_id = st.selectbox(
            "Dataset", dataset_ids, index=dataset_ids.index(default) if default in dataset_ids else 0,
            format_func=datasets.get,
        )
        st.session_state["dataset_id"] = dataset_id
        postings = get_dataset(dataset_id).postings

        role_options = sorted(postings["role"].unique())
        country_counts = postings["country"].value_counts()
        roles = st.multiselect("Job roles", role_options, placeholder="All roles",
                               help="Restrict mining to postings for these roles.")
        countries = st.multiselect("Countries", list(country_counts.index), placeholder="All countries",
                                   format_func=lambda c: f"{c} ({country_counts[c]:,})")

        st.header("Mining configuration")
        bounds = SETTINGS.sliders
        current: MiningConfig = st.session_state.get("mining_config", SETTINGS.mining)
        with st.form("mining_form", border=False):
            algorithm = st.radio("Algorithm", ALGORITHMS, index=ALGORITHMS.index(current.algorithm), horizontal=True)
            min_support = st.slider("Minimum support", min_value=bounds.support[0], max_value=bounds.support[1], step=bounds.support[2], value=current.min_support, format="%.3f",
                                    help="Minimum share of postings containing the whole skill combination.")
            min_confidence = st.slider("Minimum confidence", min_value=bounds.confidence[0], max_value=bounds.confidence[1], step=bounds.confidence[2], value=current.min_confidence, format="%.2f")
            min_lift = st.slider("Minimum lift", min_value=bounds.lift[0], max_value=bounds.lift[1], step=bounds.lift[2], value=current.min_lift, format="%.1f")
            max_len = st.slider("Maximum itemset length", min_value=bounds.max_len[0], max_value=bounds.max_len[1], step=1, value=current.max_len,
                                help="Largest number of skills in a combination (antecedent + consequent).")
            with st.expander("Ranking weights"):
                current_w: RankingWeights = st.session_state.get("weights", SETTINGS.ranking)
                w_lift = st.slider("Lift weight", min_value=0.0, max_value=1.0, value=current_w.lift, step=0.05)
                w_conf = st.slider("Confidence weight", min_value=0.0, max_value=1.0, value=current_w.confidence, step=0.05)
                w_sup = st.slider("Support weight", min_value=0.0, max_value=1.0, value=current_w.support, step=0.05)
            submitted = st.form_submit_button("Generate rules", type="primary", width="stretch",
                                              icon=":material/play_arrow:")
        if submitted:
            if w_lift + w_conf + w_sup <= 0:
                st.error("At least one ranking weight must be positive.")
            else:
                st.session_state["mining_config"] = MiningConfig(algorithm, min_support, min_confidence, min_lift, max_len)
                st.session_state["weights"] = RankingWeights(w_lift, w_conf, w_sup)

        config: MiningConfig = st.session_state.get("mining_config", SETTINGS.mining)
        weights: RankingWeights = st.session_state.get("weights", SETTINGS.ranking)
        st.caption(
            f"Active: **{config.algorithm}** · support ≥ {config.min_support:.3f} · confidence ≥ "
            f"{config.min_confidence:.2f} · lift ≥ {config.min_lift:.1f} · length ≤ {config.max_len}"
        )

    return AppContext(
        dataset_id=dataset_id,
        dataset_label=datasets[dataset_id],
        scope=(tuple(sorted(roles)), tuple(sorted(countries))),
        mining_config=config,
        weights=weights,
    )


def main() -> None:
    ctx = _sidebar()
    if ctx is None:
        _onboarding()
        return
    if ctx.postings.empty:
        st.warning("The selected roles/countries contain no postings. Widen the selection in the sidebar.")
        return

    pages = [
        st.Page(lambda: overview.render(ctx), title="Overview", icon=":material/dashboard:", default=True),
        st.Page(lambda: skill_analysis.render(ctx), title="Skill Analysis", icon=":material/bar_chart:", url_path="skills"),
        st.Page(lambda: association_mining.render(ctx), title="Association Rule Mining", icon=":material/rule:", url_path="rules"),
        st.Page(lambda: combination_explorer.render(ctx), title="Combination Explorer", icon=":material/hub:", url_path="combinations"),
        st.Page(lambda: temporal_analysis.render(ctx), title="Temporal Analysis", icon=":material/timeline:", url_path="temporal"),
        st.Page(lambda: training_planner.render(ctx), title="Training Planner", icon=":material/school:", url_path="planner"),
        st.Page(lambda: methodology.render(ctx), title="Dataset & Methodology", icon=":material/menu_book:", url_path="methodology"),
    ]
    st.navigation(pages, position="sidebar").run()


main()
