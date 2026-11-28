"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChartFrame, HBar, SkillNetwork } from "@/components/charts";
import { DataTable, Meter } from "@/components/DataTable";
import { Section, StatStrip } from "@/components/ui";
import { WithMining } from "@/components/WithMining";
import { useStore } from "@/lib/client/store";
import { fmtInt, fmtNum, fmtPct, fmtSec } from "@/lib/client/format";
import { strongestCombinations } from "@/lib/engine/rules";
import type { MiningResult } from "@/lib/engine/types";
import { PROJECT } from "@/lib/project";

const steps = (records: number, reference: boolean) => [
  {
    title: reference ? "Real job postings" : "Your postings",
    text: reference ? `${fmtInt(records)} postings with extracted skills, verified by checksum.` : `${fmtInt(records)} rows from the uploaded file.`,
  },
  { title: "Preprocessing", text: "Duplicates removed, skill names normalised, every posting turned into a skill set." },
  { title: "Frequent itemsets", text: "Apriori or FP-Growth find skill combinations above minimum support." },
  { title: "Rules and lift filter", text: "Rules scored by support, confidence and lift; coincidental ones removed." },
  { title: "Training plans", text: "Surviving rules become complementary skills and combined programmes." },
];

function Constellation({ result }: { result: MiningResult }) {
  const { frequency, label } = useStore();
  const { nodes, links } = useMemo(() => {
    const share = new Map(frequency.map((f) => [f.id, f.share]));
    const seen = new Set<string>();
    const links: { source: number; target: number; lift: number; confidence: number; support: number }[] = [];
    for (const r of result.ranked) {
      if (r.antecedent.length !== 1 || r.consequent.length !== 1) continue;
      const [a, b] = [r.antecedent[0], r.consequent[0]].sort((x, y) => x - y);
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: a, target: b, lift: r.lift, confidence: r.confidence, support: r.support });
      if (links.length >= 46) break;
    }
    const ids = [...new Set(links.flatMap((l) => [l.source, l.target]))];
    return { nodes: ids.map((id) => ({ id, label: label(id), share: share.get(id) ?? 0 })), links };
  }, [result, frequency, label]);
  if (links.length === 0) return <p className="py-16 text-center text-sm text-muted">No pairwise rules survive the current thresholds.</p>;
  return <SkillNetwork nodes={nodes} links={links} height={520} variant="hero" labelTop={34} />;
}

export default function OverviewPage() {
  const { dataset, tx, frequency, label, setLabel, scopeText } = useStore();
  if (!dataset || !tx) return null;
  const report = dataset.report;
  const top = frequency.slice(0, 15);

  return (
    <>
      <section className="grid gap-8 pb-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:items-center">
        <div className="animate-rise">
          <p className="text-sm text-signal-soft">Smart India Hackathon 2026, problem statement {PROJECT.sih.psId}</p>
          <h1 className="mt-3 text-[2.4rem] leading-[1.08] font-semibold tracking-[-0.025em] text-fg md:text-[3.1rem]">
            Which skills do employers ask for together?
          </h1>
          <p className="mt-5 max-w-xl text-[1.05rem] leading-relaxed text-muted">
            {PROJECT.problem} This dashboard mines {fmtInt(tx.total)} {dataset.kind === "reference" ? "real job postings" : "uploaded postings"} for skill combinations
            that occur more often than chance, and turns them into combined training programmes for cooperative employment planning.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/planner" className="rounded-lg bg-signal px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2a7ad4]">
              Plan a training programme
            </Link>
            <Link href="/rules" className="rounded-lg border border-line-2 bg-panel-2 px-4 py-2.5 text-sm font-medium text-fg hover:border-signal/60">
              Explore association rules
            </Link>
          </div>
          <p className="mt-6 text-xs text-faint">Showing {scopeText}.</p>
        </div>
        <div className="rounded-3xl border border-line bg-[radial-gradient(ellipse_at_center,#12284a_0%,#0a1628_70%)] p-2">
          <WithMining>{(result) => <Constellation result={result} />}</WithMining>
          <p className="px-4 pb-3 text-xs text-faint">
            The strongest pairwise rules in the current selection. Node size shows how often a skill is requested; line weight shows lift. Hover or focus a skill to see its links.
          </p>
        </div>
      </section>

      <WithMining>
        {(result) => {
          const combos = strongestCombinations(result.ranked, 10);
          return (
            <>
              <div className="mt-8">
                <StatStrip
                  stats={[
                    { label: "Job postings in source", value: fmtInt(report.original_records) },
                    { label: "Transactions mined", value: fmtInt(tx.total), hint: "Cleaned postings with at least one skill, in scope" },
                    { label: "Distinct skills", value: fmtInt(frequency.length) },
                    { label: "Frequent itemsets", value: fmtInt(result.itemsets.length), hint: `Support ≥ ${fmtPct(result.config.minSupport, 1)}` },
                    { label: "Rules surviving filters", value: fmtInt(result.ranked.length), hint: `of ${fmtInt(result.rulesGenerated)} generated` },
                    { label: "Mining time", value: fmtSec(result.seconds), hint: `${result.config.algorithm}, in your browser` },
                  ]}
                />
              </div>

              <Section title="From postings to programmes" description="Every number on this page is computed live in your browser from the selected dataset.">
                <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
                  {steps(report.original_records, dataset.kind === "reference").map((s, i) => (
                    <li key={s.title} className="bg-panel p-5">
                      <span className="text-sm font-semibold text-signal-soft">{i + 1}</span>
                      <p className="mt-2 text-[0.95rem] font-medium text-fg">{s.title}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
                    </li>
                  ))}
                </ol>
              </Section>

              <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <ChartFrame title="Most requested skills" subtitle="The individual-frequency baseline: share of postings requiring each skill.">
                  <HBar
                    data={top.map((f) => ({ label: label(f.id), value: f.share, tip: [{ label: "Share", value: fmtPct(f.share) }, { label: "Postings", value: fmtInt(f.postings) }] }))}
                    format={(v) => fmtPct(v, 0)}
                  />
                </ChartFrame>
                <ChartFrame title="Strongest skill combinations" subtitle="Best-scoring direction of each combination after support, confidence and lift filtering.">
                  <DataTable
                    rows={combos}
                    pageSize={10}
                    caption="Strongest skill combinations"
                    rowKey={(c) => c.combination.join(",")}
                    columns={[
                      { key: "combo", header: "Combination", render: (c) => <span className="font-medium">{setLabel(c.combination)}</span> },
                      { key: "dir", header: "Strongest direction", render: (c) => <span className="text-muted">{setLabel(c.antecedent)} → {setLabel(c.consequent)}</span> },
                      { key: "lift", header: "Lift", render: (c) => fmtNum(c.lift), align: "right" },
                      { key: "count", header: "Postings", render: (c) => fmtInt(c.count), align: "right" },
                      { key: "score", header: "Score", render: (c) => <Meter value={c.score} />, width: "7rem" },
                    ]}
                  />
                  <Link href="/explorer" className="mt-4 inline-block text-sm text-signal-soft hover:underline">
                    Open the combination explorer
                  </Link>
                </ChartFrame>
              </div>

              <Section title="Project brief" description={`${PROJECT.sih.event}, ${PROJECT.sih.organisation}: ${PROJECT.sih.theme}.`}>
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="rounded-2xl border border-line bg-panel p-5">
                    <p className="text-sm font-medium text-fg">Who it serves</p>
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {PROJECT.users.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-line bg-panel p-5 lg:col-span-2">
                    <p className="text-sm font-medium text-fg">What it delivers</p>
                    <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted marker:text-signal-soft">
                      {PROJECT.deliverables.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                      <li>Baseline: {PROJECT.baseline.toLowerCase()} Deliverable: {PROJECT.deliverable.toLowerCase()}</li>
                      <li>Extension: {PROJECT.extension.toLowerCase()}</li>
                    </ol>
                    <Link href="/methodology" className="mt-4 inline-block text-sm text-signal-soft hover:underline">
                      Read the full brief, data sources and method
                    </Link>
                  </div>
                </div>
              </Section>
            </>
          );
        }}
      </WithMining>
    </>
  );
}
