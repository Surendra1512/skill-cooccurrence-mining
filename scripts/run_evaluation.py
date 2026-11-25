"""Generate the evaluation report, result tables and static charts.

Usage::

    python -m scripts.run_evaluation [--repeats 3]

Outputs
-------
outputs/reports/evaluation_report.md (+ .json)
outputs/results/{ranked_rules,frequent_itemsets,skill_frequency,temporal_rule_trends,temporal_trend_summary}.csv
outputs/charts/*.html
"""

from __future__ import annotations

import argparse
import logging
import sys

import numpy as np
import pandas as pd

from config.settings import CHARTS_DIR, REPORTS_DIR, RESULTS_DIR, SETTINGS
from src.analytics.evaluation import compare_algorithms, write_evaluation_report
from src.analytics.skill_frequency import baseline_vs_association, skill_frequency, time_frequency
from src.analytics.temporal_analysis import analyse_temporal
from src.mining.association_rules import itemset_label
from src.mining.engine import run_mining
from src.mining.lift_filter import strongest_combinations
from src.preprocessing.pipeline import load_preprocessed
from src.preprocessing.transaction_builder import one_hot_encode
from src.recommendations.training_recommender import recommend
from src.visualization import charts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=3, help="timing repetitions per algorithm (median reported)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    for directory in (REPORTS_DIR, RESULTS_DIR, CHARTS_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    try:
        dataset = load_preprocessed()
    except FileNotFoundError as exc:
        logging.error("%s", exc)
        return 1
    postings, catalog = dataset.postings, dataset.skill_catalog
    labels = dict(zip(catalog["skill"], catalog["label"]))
    config, weights = SETTINGS.mining, SETTINGS.ranking

    logging.info("Encoding %s transactions", f"{len(postings):,}")
    onehot = one_hot_encode(postings["skills"], vocabulary=catalog["skill"].tolist())

    logging.info("Mining with %s", config)
    outcome = run_mining(onehot, config, weights)
    ranked = outcome.ranked.assign(
        antecedent=outcome.ranked["antecedents"].map(lambda s: itemset_label(s, labels)),
        consequent=outcome.ranked["consequents"].map(lambda s: itemset_label(s, labels)),
    )
    ranked["rule"] = ranked["antecedent"] + " → " + ranked["consequent"]
    ranked.drop(columns=["antecedents", "consequents"]).to_csv(RESULTS_DIR / "ranked_rules.csv", index=False)
    itemsets = outcome.itemsets.itemsets
    itemsets.assign(itemsets=itemsets["itemsets"].map(lambda s: itemset_label(s, labels))).to_csv(
        RESULTS_DIR / "frequent_itemsets.csv", index=False
    )

    freq = skill_frequency(postings["skills"])
    freq = freq.assign(label=freq["skill"].map(labels))
    freq.to_csv(RESULTS_DIR / "skill_frequency.csv", index=False)

    logging.info("Comparing Apriori and FP-Growth (%d repeats)", args.repeats)
    comparison = compare_algorithms(onehot, config, repeats=args.repeats)

    baseline = baseline_vs_association(postings["skills"].tolist(), freq, top_n=8)
    baseline = baseline.assign(skill_a=baseline["skill_a"].map(labels), skill_b=baseline["skill_b"].map(labels))
    top_freq = set(freq.head(10)["skill"])
    top50 = outcome.ranked.head(50)
    outside = sum(not ((a | c) <= top_freq) for a, c in zip(top50["antecedents"], top50["consequents"]))

    logging.info("Temporal analysis")
    temporal = analyse_temporal(postings, config, SETTINGS.temporal, labels, weights)
    temporal.rule_trends.to_csv(RESULTS_DIR / "temporal_rule_trends.csv", index=False)
    temporal.trend_summary.to_csv(RESULTS_DIR / "temporal_trend_summary.csv", index=False)
    trend_counts = temporal.trend_summary["trend"].value_counts().to_dict()

    combos = strongest_combinations(outcome.ranked, 5)
    rule_summary = {
        "frequent_itemsets": f"{len(itemsets):,}",
        "rules_generated": f"{outcome.filtered.generated:,}",
        "rules_after_support": f"{outcome.filtered.after_support:,}",
        "rules_after_confidence": f"{outcome.filtered.after_confidence:,}",
        "rules_after_lift (surviving)": f"{outcome.filtered.after_lift:,}",
        "median_lift_of_surviving_rules": f"{ranked['lift'].median():.2f}",
        "top_5_combinations": "; ".join(
            f"{itemset_label(c, labels)} (lift {l:.2f}, {n:,} postings)"
            for c, l, n in zip(combos["combination"], combos["lift"], combos["support_count"])
        ),
        "top_50_rules_involving_a_skill_outside_the_10_most_frequent": f"{outside} of {len(top50)}",
    }
    temporal_summary = {
        "periods_analysed": ", ".join(temporal.periods),
        "excluded_periods": ", ".join(f"{p} ({n:,} postings)" for p, n in temporal.excluded_periods.items()) or "none",
        "rules_tracked": len(temporal.trend_summary),
        "emerging / stable / declining": f"{trend_counts.get('emerging', 0)} / {trend_counts.get('stable', 0)} / "
        f"{trend_counts.get('declining', 0)}",
        "top_k_jaccard_between_consecutive_periods": ", ".join(
            f"{a}→{b}: {j:.2f}" for a, b, j in temporal.stability.itertuples(index=False)
        ),
    }
    write_evaluation_report(
        REPORTS_DIR / "evaluation_report.md", dataset.report, comparison, rule_summary,
        baseline.head(12).to_dict("records"), temporal_summary,
    )

    logging.info("Writing charts")
    recs = recommend(["sql", "excel"], outcome.ranked, postings, catalog, SETTINGS.recommender).as_frame()
    rank_frame = ranked.head(15)
    top15 = freq.head(15)["skill"].tolist()
    matrix = onehot[top15].to_numpy(dtype=np.float32)
    joint = matrix.T @ matrix
    marginal = np.diag(joint) / len(matrix)
    lift_matrix = pd.DataFrame((joint / len(matrix)) / np.outer(marginal, marginal), index=top15, columns=top15)
    skill_trend = time_frequency(postings, freq.head(6)["skill"].tolist(), "Q")
    skill_trend = skill_trend[skill_trend["period"].isin(temporal.periods)].assign(label=lambda d: d["skill"].map(labels))
    figures = {
        "01_top20_skills": charts.top_skills_bar(freq.head(20), "Top 20 individual skills"),
        "02_skill_frequency_distribution": charts.frequency_distribution(freq),
        "03_rule_ranking": charts.rule_ranking_bar(rank_frame, 15),
        "04_support_vs_confidence": charts.support_confidence_scatter(ranked),
        "05_lift_distribution": charts.lift_histogram(outcome.all_rules, config.min_lift),
        "06_cooccurrence_heatmap_lift": charts.cooccurrence_heatmap(lift_matrix, labels, "Lift"),
        "07_skill_network": charts.skill_network(ranked, freq, labels),
        "08_temporal_skill_trends": charts.trend_lines(
            skill_trend, "period", "share", "label", "Share of postings requiring each skill, by quarter", "Share of postings"
        ),
        "09_temporal_rule_trends": charts.trend_lines(
            temporal.rule_trends[temporal.rule_trends["rule"].isin(temporal.trend_summary.head(6)["rule"])],
            "period", "support", "rule", "Rule support by quarter", "Support",
        ),
        "10_training_combination_comparison_sql_excel": charts.recommendation_comparison(recs),
    }
    for name, fig in figures.items():
        fig.write_html(CHARTS_DIR / f"{name}.html", include_plotlyjs="cdn")

    logging.info("Done. Report: %s", REPORTS_DIR / "evaluation_report.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
