"use client";

import { useStore } from "@/lib/client/store";
import { fmtInt, fmtNum, fmtPct, toCsv } from "@/lib/client/format";
import type { Rule } from "@/lib/engine/types";
import { DataTable, Meter, type Column } from "./DataTable";

export function RulesTable({ rules, pageSize = 12, caption = "Association rules" }: { rules: Rule[]; pageSize?: number; caption?: string }) {
  const { setLabel } = useStore();
  const columns: Column<Rule>[] = [
    { key: "rank", header: "Rank", render: (r) => <span className="text-muted">{r.rank}</span>, sortValue: (r) => -r.rank, align: "right", width: "4.5rem" },
    { key: "a", header: "If a posting requires", render: (r) => setLabel(r.antecedent), sortValue: (r) => setLabel(r.antecedent) },
    { key: "c", header: "it also tends to require", render: (r) => <span className="text-signal-soft">{setLabel(r.consequent)}</span>, sortValue: (r) => setLabel(r.consequent) },
    { key: "support", header: "Support", render: (r) => fmtPct(r.support, 2), sortValue: (r) => r.support, align: "right", title: "Share of all postings that contain every skill of the rule" },
    { key: "confidence", header: "Confidence", render: (r) => fmtPct(r.confidence), sortValue: (r) => r.confidence, align: "right", title: "Share of postings with the antecedent that also contain the consequent" },
    { key: "lift", header: "Lift", render: (r) => fmtNum(r.lift), sortValue: (r) => r.lift, align: "right", title: "Confidence ÷ consequent support; above 1 means more often than chance" },
    { key: "count", header: "Postings", render: (r) => fmtInt(r.count), sortValue: (r) => r.count, align: "right" },
    {
      key: "score",
      header: "Score",
      render: (r) => (
        <span className="flex items-center gap-2">
          <Meter value={r.score} />
          <span className="w-10 text-right text-muted">{r.score.toFixed(3)}</span>
        </span>
      ),
      sortValue: (r) => r.score,
      width: "11rem",
    },
  ];
  return <DataTable rows={rules} columns={columns} pageSize={pageSize} caption={caption} rowKey={(r) => `${r.antecedent.join(",")}>${r.consequent.join(",")}`} />;
}

export function rulesCsv(rules: Rule[], setLabel: (ids: number[]) => string): string {
  return toCsv(
    rules.map((r) => ({
      rank: r.rank,
      antecedent: setLabel(r.antecedent),
      consequent: setLabel(r.consequent),
      support: r.support,
      confidence: r.confidence,
      lift: r.lift,
      leverage: r.leverage,
      conviction: r.conviction ?? "",
      postings: r.count,
      antecedent_postings: r.antecedentCount,
      consequent_postings: r.consequentCount,
      score: r.score,
    })),
  );
}
