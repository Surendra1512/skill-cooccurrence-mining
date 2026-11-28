"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { openMiningSettings } from "@/components/AppShell";
import { ChartFrame, HBar, SupportConfidence, VBar } from "@/components/charts";
import { DataTable } from "@/components/DataTable";
import { MiningSettings } from "@/components/MiningSettings";
import { MultiSelect } from "@/components/MultiSelect";
import { RulesTable, rulesCsv } from "@/components/RulesTable";
import { Button, Callout, DownloadButton, Loading, PageHeader, Panel, Section, SelectField, StatStrip, TabPanel, Tabs } from "@/components/ui";
import { WithMining } from "@/components/WithMining";
import { useStore } from "@/lib/client/store";
import { download, fmtInt, fmtNum, fmtPct, fmtSec, toCsv } from "@/lib/client/format";
import { liftInterpretation, normaliseWeights, scoreScalers } from "@/lib/engine/rules";
import type { ComparisonResult, MiningResult, Rule } from "@/lib/engine/types";

const TABS = [
  { id: "rules", label: "Ranked rules" },
  { id: "charts", label: "Rule charts" },
  { id: "explain", label: "Explain a rule" },
  { id: "compare", label: "Apriori vs FP-Growth" },
];

export default function RulesPage() {
  const [tab, setTab] = useState("rules");
  return (
    <>
      <PageHeader
        title="Association rules"
        lead="Frequent skill combinations are mined with Apriori or FP-Growth, every rule is scored by support, confidence and lift, and rules failing any threshold are removed before ranking."
      >
        <span className="2xl:hidden">
          <Button variant="primary" onClick={openMiningSettings} icon={<SlidersHorizontal size={15} aria-hidden />}>
            Change algorithm and thresholds
          </Button>
        </span>
      </PageHeader>
      <div className="mt-8 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <WithMining>
            {(result) => (
              <>
                <StatStrip
                  stats={[
                    { label: "Algorithm", value: result.config.algorithm },
                    { label: "Mining time", value: fmtSec(result.seconds), hint: `${fmtInt(result.uniqueTransactions)} distinct skill sets` },
                    { label: "Frequent itemsets", value: fmtInt(result.itemsets.length) },
                    { label: "Rules generated", value: fmtInt(result.rulesGenerated) },
                    { label: "Rules surviving", value: fmtInt(result.ranked.length) },
                  ]}
                />
                <Glossary />
                <Tabs tabs={TABS} active={tab} onChange={setTab} />
                <TabPanel id={tab}>
                  {tab === "rules" && <RulesTab result={result} />}
                  {tab === "charts" && <ChartsTab result={result} />}
                  {tab === "explain" && <ExplainTab result={result} />}
                  {tab === "compare" && <CompareTab />}
                </TabPanel>
              </>
            )}
          </WithMining>
        </div>
        <aside aria-label="Mining configuration" className="hidden 2xl:sticky 2xl:top-28 2xl:block 2xl:self-start">
          <Panel tone="raised">
            <h2 className="mb-5 text-base font-semibold">Configuration</h2>
            <MiningSettings />
          </Panel>
        </aside>
      </div>
    </>
  );
}

function Glossary() {
  return (
    <details className="group mt-6 rounded-2xl border border-line bg-panel">
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-fg marker:hidden">
        How to read support, confidence and lift <span className="text-muted group-open:hidden">(show)</span>
      </summary>
      <div className="grid gap-px border-t border-line bg-line md:grid-cols-3">
        {[
          ["Support", "P(A ∪ B)", "Share of all postings containing every skill of the rule. Low support means thin evidence."],
          ["Confidence", "P(A ∪ B) ÷ P(A)", "Of postings that require A, the share that also require B."],
          ["Lift", "Confidence ÷ P(B)", "How much more often B appears with A than in general. Above 1 is a positive association, 1 is independence, below 1 is negative."],
        ].map(([name, formula, text]) => (
          <div key={name} className="bg-panel p-5">
            <p className="font-medium text-fg">{name}</p>
            <p className="mt-1 text-sm text-signal-soft">{formula}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-5 py-4 text-sm leading-relaxed text-muted">
        High lift alone is not enough: a rule seen in a handful of postings can have a very high lift by chance. Rules are filtered on all three
        measures and ranked by a weighted score.
      </p>
    </details>
  );
}

function RulesTab({ result }: { result: MiningResult }) {
  const { setLabel, label, dataset } = useStore();
  const [skills, setSkills] = useState<number[]>([]);
  const [shape, setShape] = useState<"all" | "11" | "multiA" | "multiC">("all");
  const inRules = useMemo(() => {
    const ids = new Set<number>();
    result.ranked.forEach((r) => [...r.antecedent, ...r.consequent].forEach((s) => ids.add(s)));
    return [...ids].map((id) => ({ value: id, label: label(id) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [result, label]);
  const shown = result.ranked.filter((r) => {
    if (skills.length && !skills.some((s) => r.antecedent.includes(s) || r.consequent.includes(s))) return false;
    if (shape === "11") return r.antecedent.length === 1 && r.consequent.length === 1;
    if (shape === "multiA") return r.antecedent.length > 1;
    if (shape === "multiC") return r.consequent.length > 1;
    return true;
  });
  if (result.ranked.length === 0) return <Callout tone="warn">No rule survives the current thresholds. Lower minimum support, confidence or lift.</Callout>;
  return (
    <Section>
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <MultiSelect label="Rules involving skills" options={inRules} value={skills} onChange={setSkills} allLabel="Any skill" />
        <SelectField
          label="Rule shape"
          value={shape}
          options={[
            { value: "all", label: "All shapes" },
            { value: "11", label: "One skill → one skill" },
            { value: "multiA", label: "Several skills → …" },
            { value: "multiC", label: "… → several skills" },
          ]}
          onChange={setShape}
        />
      </div>
      <p className="mb-3 text-sm text-muted">
        {fmtInt(shown.length)} of {fmtInt(result.ranked.length)} surviving rules.
      </p>
      <RulesTable rules={shown} pageSize={15} />
      <div className="mt-4 flex flex-wrap gap-2">
        <DownloadButton onClick={() => download("association_rules.csv", rulesCsv(shown, setLabel), "text/csv")} disabled={shown.length === 0}>
          Download shown rules
        </DownloadButton>
        <DownloadButton
          onClick={() =>
            download(
              "frequent_itemsets.csv",
              toCsv(result.itemsets.map((s) => ({ itemset: setLabel(s.items), length: s.items.length, postings: s.count, support: s.count / result.total }))),
              "text/csv",
            )
          }
        >
          Download frequent itemsets
        </DownloadButton>
      </div>
      {dataset?.kind === "reference" && <p className="mt-3 text-xs text-faint">Rules are computed in your browser from the real postings each time the configuration changes.</p>}
    </Section>
  );
}

function ChartsTab({ result }: { result: MiningResult }) {
  const { ruleLabel } = useStore();
  const lifts = result.allLifts;
  const bins = useMemo(() => {
    const max = Math.min(Math.max(...lifts, 2), 30);
    const width = max / 40;
    const counts = new Array(40).fill(0);
    lifts.forEach((l) => counts[Math.min(39, Math.floor(Math.min(l, max - 1e-9) / width))]++);
    return { width, data: counts.map((c, i) => ({ x: (i * width).toFixed(1), value: c })) };
  }, [lifts]);
  const ref = (v: number) => (Math.floor(v / bins.width) * bins.width).toFixed(1);
  const s = result.stages;
  return (
    <>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartFrame title="Rules surviving each filter" subtitle="Support, then confidence, then lift.">
          <HBar
            data={[
              { label: "Generated", value: s.generated },
              { label: "≥ min support", value: s.afterSupport },
              { label: "≥ min confidence", value: s.afterConfidence },
              { label: "≥ min lift", value: s.afterLift },
            ]}
            format={fmtInt}
            labelWidth={120}
          />
        </ChartFrame>
        <ChartFrame title="Lift of all generated rules" subtitle="Rules left of the threshold are removed as weak or coincidental.">
          <VBar
            data={bins.data}
            xLabel="Lift"
            yFormat={fmtInt}
            references={[
              { x: ref(1), label: "Independence", color: "#8fa3bf", dashed: true },
              { x: ref(result.config.minLift), label: `Min lift ${result.config.minLift.toFixed(1)}` },
            ]}
          />
        </ChartFrame>
      </div>
      <div className="mt-6">
        <ChartFrame title="Top 15 rules by composite score">
          <HBar
            data={result.ranked.slice(0, 15).map((r) => ({
              label: ruleLabel(r),
              value: r.score,
              tip: [
                { label: "Score", value: r.score.toFixed(3) },
                { label: "Support", value: fmtPct(r.support, 2) },
                { label: "Confidence", value: fmtPct(r.confidence) },
                { label: "Lift", value: fmtNum(r.lift) },
              ],
            }))}
            format={(v) => v.toFixed(2)}
            domainMax={1}
            labelWidth={260}
          />
        </ChartFrame>
      </div>
      <div className="mt-6">
        <ChartFrame title="Support versus confidence" subtitle={`Each dot is a surviving rule; colour shows lift (darker is lower).${result.ranked.length > 3000 ? " First 3,000 rules by rank." : ""}`}>
          <SupportConfidence points={result.ranked.slice(0, 3000).map((r) => ({ support: r.support, confidence: r.confidence, lift: r.lift, label: ruleLabel(r) }))} />
        </ChartFrame>
      </div>
    </>
  );
}

function ExplainTab({ result }: { result: MiningResult }) {
  const { ruleLabel, setLabel, weights } = useStore();
  const [index, setIndex] = useState(0);
  if (result.ranked.length === 0) return <Callout tone="warn">No surviving rules to explain.</Callout>;
  const options = result.ranked.slice(0, 300).map((r, i) => ({ value: i, label: `#${r.rank}  ${ruleLabel(r)}` }));
  const rule: Rule = result.ranked[Math.min(index, result.ranked.length - 1)];
  const scale = scoreScalers(result.ranked);
  const [wl, wc, ws] = normaliseWeights(weights);
  const parts = [
    { component: "log₂ lift", scaled: scale.lift(rule), weight: wl },
    { component: "Confidence", scaled: scale.confidence(rule), weight: wc },
    { component: "log₁₀ support", scaled: scale.support(rule), weight: ws },
  ];
  return (
    <Section>
      <SelectField label="Rule (top 300 by rank)" value={index} options={options} onChange={setIndex} />
      <Panel tone="raised" className="mt-5">
        <p className="text-xl font-semibold text-fg">
          {setLabel(rule.antecedent)} <span className="text-muted">→</span> <span className="text-signal-soft">{setLabel(rule.consequent)}</span>
        </p>
        <p className="mt-3 max-w-3xl leading-relaxed text-fg/90">
          Of {fmtInt(rule.antecedentCount)} postings requiring {setLabel(rule.antecedent)}, {fmtPct(rule.confidence)} also require {setLabel(rule.consequent)}. That is{" "}
          {fmtNum(rule.lift)}× the rate across all postings ({fmtPct(rule.consequentSupport)}), a {liftInterpretation(rule.lift)}.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          {[
            ["Support", `${fmtPct(rule.support, 2)} (${fmtInt(rule.count)} postings)`],
            ["Confidence", fmtPct(rule.confidence)],
            ["Lift", fmtNum(rule.lift)],
            ["Leverage", rule.leverage.toFixed(4)],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel p-3">
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="mt-0.5 font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <h3 className="mt-8 mb-3 text-base font-semibold">Score breakdown</h3>
      <p className="mb-3 text-sm text-muted">Each component is scaled from 0 to 1 across the surviving rules, then weighted.</p>
      <DataTable
        rows={parts}
        caption="Score breakdown"
        rowKey={(p) => p.component}
        columns={[
          { key: "c", header: "Component", render: (p) => p.component },
          { key: "s", header: "Scaled value", render: (p) => p.scaled.toFixed(3), align: "right" },
          { key: "w", header: "Weight", render: (p) => p.weight.toFixed(2), align: "right" },
          { key: "x", header: "Contribution", render: (p) => (p.scaled * p.weight).toFixed(3), align: "right" },
        ]}
      />
      <p className="mt-3 text-sm text-muted">
        Total score <span className="font-medium text-fg">{rule.score.toFixed(3)}</span>, rank {rule.rank} of {fmtInt(result.ranked.length)}.
      </p>
    </Section>
  );
}

function CompareTab() {
  const { compare } = useStore();
  const [state, setState] = useState<{ status: "idle" | "running" | "done" | "error"; result?: ComparisonResult; error?: string }>({ status: "idle" });
  const run = () => {
    setState({ status: "running" });
    compare()
      .then((result) => setState({ status: "done", result }))
      .catch((e: Error) => setState({ status: "error", error: e.message }));
  };
  return (
    <Section
      title="Apriori versus FP-Growth"
      description="Both algorithms receive the same transactions and thresholds. Identical output confirms correctness; the difference is speed."
      actions={
        <Button variant="primary" onClick={run} disabled={state.status === "running"}>
          {state.status === "running" ? "Running both…" : state.status === "done" ? "Run again" : "Run comparison"}
        </Button>
      }
    >
      {state.status === "running" && <Loading label="Running Apriori and FP-Growth on the same input…" />}
      {state.status === "error" && <Callout tone="warn">{state.error}</Callout>}
      {state.result && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <DataTable
              rows={state.result.runs}
              caption="Algorithm comparison"
              rowKey={(r) => r.algorithm}
              columns={[
                { key: "a", header: "Algorithm", render: (r) => r.algorithm },
                { key: "t", header: "Time", render: (r) => fmtSec(r.seconds), align: "right" },
                { key: "i", header: "Itemsets", render: (r) => fmtInt(r.itemsets), align: "right" },
                { key: "r", header: "Rules", render: (r) => fmtInt(r.rules), align: "right" },
                { key: "s", header: "Surviving", render: (r) => fmtInt(r.surviving), align: "right" },
              ]}
            />
            <ul className="mt-4 space-y-1.5 text-sm text-muted">
              <li>
                Identical frequent itemsets: <span className="font-medium text-fg">{state.result.identicalItemsets ? "yes" : "no"}</span> (Jaccard {state.result.jaccard.toFixed(4)})
              </li>
              <li>
                Largest support difference: <span className="font-medium text-fg">{state.result.maxSupportDifference.toExponential(1)}</span>
              </li>
              <li>
                Identical surviving rules: <span className="font-medium text-fg">{state.result.identicalRules ? "yes" : "no"}</span>
              </li>
            </ul>
          </div>
          <ChartFrame title="Execution time" subtitle="Measured in this browser; times vary between runs and machines.">
            <HBar data={state.result.runs.map((r) => ({ label: r.algorithm, value: r.seconds }))} format={fmtSec} labelWidth={90} />
          </ChartFrame>
        </div>
      )}
    </Section>
  );
}
