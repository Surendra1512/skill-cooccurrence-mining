"use client";

import { useMemo, useState } from "react";
import { ChartFrame, Heatmap, SkillNetwork } from "@/components/charts";
import { DataTable, Meter } from "@/components/DataTable";
import { RulesTable } from "@/components/RulesTable";
import { Callout, DataToggle, PageHeader, Section, Segmented, SelectField, SliderField, TabPanel, Tabs } from "@/components/ui";
import { WithMining } from "@/components/WithMining";
import { useStore } from "@/lib/client/store";
import { fmtInt, fmtNum, fmtPct } from "@/lib/client/format";
import { pairCounts } from "@/lib/engine/frequency";
import { strongestCombinations } from "@/lib/engine/rules";
import type { MiningResult, Rule } from "@/lib/engine/types";

const TABS = [
  { id: "network", label: "Relationship network" },
  { id: "heatmap", label: "Co-occurrence heatmap" },
  { id: "combos", label: "Strongest combinations" },
  { id: "skill", label: "Rules for a skill" },
];

export default function ExplorerPage() {
  return (
    <>
      <PageHeader title="Combination explorer" lead="See how skills connect through the surviving rules. Raise the lift filter to keep only the most distinctive combinations, without mining again." />
      <WithMining>{(result) => <Explorer result={result} />}</WithMining>
    </>
  );
}

function Explorer({ result }: { result: MiningResult }) {
  const [tab, setTab] = useState("network");
  const minLift = result.config.minLift;
  const maxLift = Math.max(minLift + 0.1, ...result.ranked.map((r) => r.lift));
  const [floorState, setFloor] = useState(minLift);
  const floor = Math.min(Math.max(floorState, minLift), maxLift);
  const view = useMemo(() => result.ranked.filter((r) => r.lift >= floor), [result, floor]);
  if (result.ranked.length === 0) return <Callout tone="warn">No rule survives the current thresholds. Relax them in Mining settings.</Callout>;
  return (
    <>
      <div className="mt-8 max-w-xl">
        <SliderField
          label="Extra lift filter for this page"
          value={floor}
          min={minLift}
          max={Math.ceil(maxLift * 10) / 10}
          step={0.1}
          format={(v) => `lift ≥ ${v.toFixed(1)}`}
          hint={`${fmtInt(view.length)} of ${fmtInt(result.ranked.length)} rules shown.`}
          onChange={setFloor}
        />
      </div>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <TabPanel id={tab}>
        {tab === "network" && <NetworkTab rules={view} />}
        {tab === "heatmap" && <HeatmapTab />}
        {tab === "combos" && <CombosTab rules={view} />}
        {tab === "skill" && <SkillTab rules={view} />}
      </TabPanel>
    </>
  );
}

function NetworkTab({ rules }: { rules: Rule[] }) {
  const { frequency, label } = useStore();
  const [maxLinks, setMaxLinks] = useState(60);
  const { nodes, links } = useMemo(() => {
    const share = new Map(frequency.map((f) => [f.id, f.share]));
    const seen = new Set<string>();
    const links: { source: number; target: number; lift: number; confidence: number; support: number }[] = [];
    for (const r of rules) {
      if (r.antecedent.length !== 1 || r.consequent.length !== 1) continue;
      const [a, b] = [r.antecedent[0], r.consequent[0]].sort((x, y) => x - y);
      if (seen.has(`${a}-${b}`)) continue;
      seen.add(`${a}-${b}`);
      links.push({ source: a, target: b, lift: r.lift, confidence: r.confidence, support: r.support });
      if (links.length >= maxLinks) break;
    }
    const ids = [...new Set(links.flatMap((l) => [l.source, l.target]))];
    return { nodes: ids.map((id) => ({ id, label: label(id), share: share.get(id) ?? 0 })), links };
  }, [rules, frequency, label, maxLinks]);

  return (
    <Section>
      <ChartFrame
        title={`Skill relationship network (${links.length} strongest pairwise links)`}
        subtitle="Node size and colour: share of postings requiring the skill. Line weight: lift of the strongest rule between the two skills."
        actions={<Segmented label="Links shown" options={[30, 60, 100] as const} value={maxLinks as 30 | 60 | 100} onChange={setMaxLinks} format={(v) => `${v} links`} />}
      >
        {links.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">No one-skill-to-one-skill rule passes the filter. Lower the lift filter.</p>
        ) : (
          <SkillNetwork nodes={nodes} links={links} height={640} labelTop={40} />
        )}
        <DataToggle>
          <DataTable
            rows={links}
            caption="Network links"
            rowKey={(l) => `${l.source}-${l.target}`}
            pageSize={15}
            columns={[
              { key: "pair", header: "Skills", render: (l) => `${label(l.source)} + ${label(l.target)}` },
              { key: "lift", header: "Lift", render: (l) => fmtNum(l.lift), sortValue: (l) => l.lift, align: "right" },
              { key: "conf", header: "Confidence", render: (l) => fmtPct(l.confidence), sortValue: (l) => l.confidence, align: "right" },
              { key: "sup", header: "Support", render: (l) => fmtPct(l.support, 2), sortValue: (l) => l.support, align: "right" },
            ]}
          />
        </DataToggle>
      </ChartFrame>
    </Section>
  );
}

function HeatmapTab() {
  const { tx, frequency, label } = useStore();
  const [n, setN] = useState(18);
  const [metric, setMetric] = useState<"Lift" | "Postings together">("Lift");
  const data = useMemo(() => {
    if (!tx) return null;
    const top = frequency.slice(0, n);
    const counts = pairCounts(tx, top.map((f) => f.id));
    const lift = counts.map((row, i) => row.map((c, j) => (c / tx.total) / (top[i].share * top[j].share)));
    return { names: top.map((f) => label(f.id)), counts, lift };
  }, [tx, frequency, label, n]);
  if (!data) return null;
  const values = metric === "Lift" ? data.lift : data.counts;
  return (
    <Section
      title="Pairwise co-occurrence of the most frequent skills"
      description="Lift below 1 (darkest) means the two skills appear together less often than chance, even when both are popular."
      actions={
        <>
          <SelectField label="Skills" hideLabel value={n} options={[10, 14, 18, 24, 30].map((v) => ({ value: v, label: `Top ${v} skills` }))} onChange={setN} />
          <Segmented label="Cell value" options={["Lift", "Postings together"] as const} value={metric} onChange={setMetric} />
        </>
      }
    >
      <ChartFrame title={`Co-occurrence heatmap (${metric.toLowerCase()})`}>
        <Heatmap
          rows={data.names}
          cols={data.names}
          values={values}
          diagonalBlank
          format={metric === "Lift" ? (v) => fmtNum(v) : (v) => fmtInt(v)}
          cellTip={(r, c) => [
            { label: "Lift", value: fmtNum(data.lift[r][c]) },
            { label: "Postings together", value: fmtInt(data.counts[r][c]) },
          ]}
        />
      </ChartFrame>
    </Section>
  );
}

function CombosTab({ rules }: { rules: Rule[] }) {
  const { setLabel } = useStore();
  const [size, setSize] = useState<"Any size" | "2 skills" | "3 skills" | "4+ skills">("Any size");
  const combos = useMemo(() => strongestCombinations(rules, rules.length), [rules]);
  const shown = combos.filter((c) => (size === "Any size" ? true : size === "4+ skills" ? c.combination.length >= 4 : c.combination.length === Number(size[0]))).slice(0, 100);
  return (
    <Section
      title="Strongest combinations"
      description="Each combination appears once, with its best-scoring rule direction."
      actions={<Segmented label="Combination size" options={["Any size", "2 skills", "3 skills", "4+ skills"] as const} value={size} onChange={setSize} />}
    >
      <DataTable
        rows={shown}
        pageSize={15}
        caption="Strongest combinations"
        rowKey={(c) => c.combination.join(",")}
        columns={[
          { key: "c", header: "Combination", render: (c) => <span className="font-medium">{setLabel(c.combination)}</span>, sortValue: (c) => setLabel(c.combination) },
          { key: "d", header: "Strongest direction", render: (c) => <span className="text-muted">{setLabel(c.antecedent)} → {setLabel(c.consequent)}</span> },
          { key: "n", header: "Postings", render: (c) => fmtInt(c.count), sortValue: (c) => c.count, align: "right" },
          { key: "conf", header: "Confidence", render: (c) => fmtPct(c.confidence), sortValue: (c) => c.confidence, align: "right" },
          { key: "lift", header: "Lift", render: (c) => fmtNum(c.lift), sortValue: (c) => c.lift, align: "right" },
          { key: "s", header: "Score", render: (c) => <Meter value={c.score} />, sortValue: (c) => c.score, width: "8rem" },
        ]}
      />
    </Section>
  );
}

function SkillTab({ rules }: { rules: Rule[] }) {
  const { label } = useStore();
  const options = useMemo(() => {
    const ids = new Set<number>();
    rules.forEach((r) => [...r.antecedent, ...r.consequent].forEach((s) => ids.add(s)));
    return [...ids].map((id) => ({ value: id, label: label(id) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rules, label]);
  const [skill, setSkill] = useState<number | null>(null);
  const current = skill ?? options.find((o) => o.label === "Python")?.value ?? options[0]?.value;
  if (current === undefined) return null;
  const leads = rules.filter((r) => r.antecedent.includes(current));
  const ledBy = rules.filter((r) => r.consequent.includes(current));
  return (
    <Section title="Rules for one skill" description="Rules where the skill is required first, and rules that lead to it.">
      <div className="max-w-sm">
        <SelectField label="Skill" value={current} options={options} onChange={setSkill} />
      </div>
      <h3 className="mt-6 mb-3 text-[0.95rem] font-medium">
        Postings requiring {label(current)} also tend to require… <span className="text-muted">({fmtInt(leads.length)} rules)</span>
      </h3>
      <RulesTable rules={leads} pageSize={8} caption={`Rules starting from ${label(current)}`} />
      <h3 className="mt-8 mb-3 text-[0.95rem] font-medium">
        {label(current)} tends to be required with… <span className="text-muted">({fmtInt(ledBy.length)} rules)</span>
      </h3>
      <RulesTable rules={ledBy} pageSize={8} caption={`Rules leading to ${label(current)}`} />
    </Section>
  );
}
