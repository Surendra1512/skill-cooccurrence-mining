"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartFrame, FirstLastBars, Lines } from "@/components/charts";
import { DataTable } from "@/components/DataTable";
import { MultiSelect } from "@/components/MultiSelect";
import { Callout, DataToggle, DownloadButton, Loading, PageHeader, Pill, Section, Segmented, SelectField, StatStrip, TabPanel, Tabs } from "@/components/ui";
import { DEFAULT_TEMPORAL, useStore } from "@/lib/client/store";
import { download, fmtInt, fmtNum, fmtPct, toCsv } from "@/lib/client/format";
import { segmentFrequency, segmentSizes } from "@/lib/engine/frequency";
import type { TemporalResult, TrendRow } from "@/lib/engine/types";

const TABS = [
  { id: "skills", label: "Skill trends" },
  { id: "rules", label: "Rule trends" },
  { id: "movers", label: "Emerging and declining" },
  { id: "compare", label: "Period comparison" },
];

export default function TemporalPage() {
  const { dataset, scope, temporal, mining, tx } = useStore();
  const [tab, setTab] = useState("skills");
  const dated = useMemo(() => (dataset ? segmentSizes(dataset.groups, scope, "quarter").filter(([q]) => q !== 255).reduce((s, [, n]) => s + n, 0) : 0), [dataset, scope]);
  const adaptive = Math.max(200, Math.min(DEFAULT_TEMPORAL.minTransactionsPerPeriod, Math.round((dated * 0.02) / 100) * 100));
  const [minTx, setMinTx] = useState<number | null>(null);
  const [topK, setTopK] = useState(DEFAULT_TEMPORAL.topK);
  const effectiveMin = minTx ?? adaptive;
  const [state, setState] = useState<{ status: "running" | "done" | "error"; result?: TemporalResult; error?: string }>({ status: "running" });

  useEffect(() => {
    if (!dataset || mining.status === "error") return;
    let live = true;
    setState((s) => ({ status: "running", result: s.result }));
    temporal({ ...DEFAULT_TEMPORAL, minTransactionsPerPeriod: effectiveMin, topK })
      .then((result) => live && setState({ status: "done", result }))
      .catch((e: Error) => live && setState({ status: "error", error: e.message }));
    return () => {
      live = false;
    };
  }, [dataset, temporal, effectiveMin, topK, mining.status]);

  if (!dataset || !tx) return null;
  if (dated === 0) {
    return (
      <>
        <PageHeader title="Temporal analysis" lead="How the strongest skill combinations shift over time." />
        <div className="mt-8">
          <Callout tone="warn">This dataset has no posting dates, so temporal analysis is not possible.</Callout>
        </div>
      </>
    );
  }
  const result = state.result;
  const counts = result ? { emerging: result.trends.filter((t) => t.trend === "emerging").length, declining: result.trends.filter((t) => t.trend === "declining").length } : null;

  return (
    <>
      <PageHeader
        title="Temporal analysis"
        lead="Rules are mined again inside every quarter with the active thresholds. The strongest rules of each quarter are then tracked across all quarters to find combinations that are emerging or declining."
      />
      <div className="mt-8 flex flex-wrap items-end gap-4">
        <SelectField
          label="Minimum postings per quarter"
          value={effectiveMin}
          options={[...new Set([200, 500, 1000, 2000, 5000, 10000, adaptive])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${fmtInt(v)} postings` }))}
          onChange={setMinTx}
        />
        <SelectField label="Top rules tracked per quarter" value={topK} options={[10, 25, 50].map((v) => ({ value: v, label: `Top ${v}` }))} onChange={setTopK} />
      </div>

      {state.status === "error" && (
        <div className="mt-6">
          <Callout tone="warn">{state.error}</Callout>
        </div>
      )}
      {!result && state.status === "running" && <Loading label="Mining every quarter…" />}
      {result && (
        <div className={state.status === "running" ? "opacity-60" : undefined} aria-busy={state.status === "running"}>
          <div className="mt-6 space-y-3">
            {Object.keys(result.excluded).length > 0 && (
              <Callout>
                Quarters below {fmtInt(effectiveMin)} postings were excluded:{" "}
                {Object.entries(result.excluded)
                  .map(([q, n]) => `${q} (${fmtInt(n)})`)
                  .join(", ")}
                .
              </Callout>
            )}
            <p className="text-sm text-muted">
              Coverage {result.periods[0]} to {result.periods[result.periods.length - 1]}. Shifts describe this window only and should not be read as long-run trends.
              {result.undated > 0 && ` ${fmtInt(result.undated)} undated postings are excluded.`}
            </p>
          </div>
          <div className="mt-6">
            <StatStrip
              stats={[
                { label: "Quarters analysed", value: String(result.periods.length) },
                { label: "Rules tracked", value: fmtInt(result.trends.length) },
                { label: "Emerging", value: fmtInt(counts!.emerging), hint: "Support up ≥ 15%, consistent slope" },
                { label: "Declining", value: fmtInt(counts!.declining), hint: "Support down ≥ 15%, consistent slope" },
              ]}
            />
          </div>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <TabPanel id={tab}>
            {tab === "skills" && <SkillTrends periods={result.periods} />}
            {tab === "rules" && <RuleTrends result={result} />}
            {tab === "movers" && <Movers result={result} />}
            {tab === "compare" && <Compare result={result} />}
          </TabPanel>
        </div>
      )}
    </>
  );
}

function SkillTrends({ periods }: { periods: string[] }) {
  const { dataset, scope, frequency, label } = useStore();
  const [skills, setSkills] = useState<number[]>(() => frequency.slice(0, 5).map((f) => f.id));
  const data = useMemo(() => {
    if (!dataset) return [];
    const qs = periods.map((p) => dataset.quarters.indexOf(p));
    const cells = segmentFrequency(dataset.groups, scope, "quarter", skills, qs);
    return periods.map((p, i) => {
      const row: Record<string, number | string> = { period: p };
      skills.forEach((s, k) => (row[label(s)] = cells[i * skills.length + k].share));
      return row;
    });
  }, [dataset, scope, skills, periods, label]);
  return (
    <Section>
      <div className="mb-5 max-w-2xl">
        <MultiSelect label="Skills (up to 8)" options={frequency.map((f) => ({ value: f.id, label: label(f.id) }))} value={skills} onChange={setSkills} max={8} />
      </div>
      <ChartFrame title="Share of postings requiring each skill, by quarter">
        {skills.length ? <Lines data={data} series={skills.map(label)} format={(v) => fmtPct(v, 1)} yLabel="Share" /> : <p className="py-10 text-center text-sm text-muted">Select at least one skill.</p>}
        <DataToggle>
          <DataTable
            rows={data}
            caption="Skill share by quarter"
            rowKey={(r) => String(r.period)}
            columns={[{ key: "p", header: "Quarter", render: (r) => r.period }, ...skills.map((s) => ({ key: String(s), header: label(s), render: (r: Record<string, number | string>) => fmtPct(Number(r[label(s)])), align: "right" as const }))]}
          />
        </DataToggle>
      </ChartFrame>
    </Section>
  );
}

function RuleTrends({ result }: { result: TemporalResult }) {
  const [metric, setMetric] = useState<"support" | "confidence" | "lift">("support");
  const options = useMemo(() => [...result.trends].sort((a, b) => b.supportLast - a.supportLast).map((t, i) => ({ value: i, label: t.rule, rule: t.rule })), [result]);
  const [selected, setSelected] = useState<number[]>([0, 1, 2, 3, 4].filter((i) => i < options.length));
  const rules = selected.map((i) => options[i]?.rule).filter(Boolean) as string[];
  const data = result.periods.map((p) => {
    const row: Record<string, number | string> = { period: p };
    for (const r of rules) {
      const m = result.metrics.find((x) => x.rule === r && x.period === p);
      if (m) row[r] = m[metric];
    }
    return row;
  });
  const format = metric === "lift" ? (v: number) => fmtNum(v) : (v: number) => fmtPct(v, metric === "support" ? 2 : 1);
  return (
    <>
      <Section actions={<Segmented label="Metric" options={["support", "confidence", "lift"] as const} value={metric} onChange={setMetric} format={(v) => v[0].toUpperCase() + v.slice(1)} />}>
        <div className="mb-5">
          <MultiSelect label="Tracked rules (up to 8)" options={options} value={selected} onChange={setSelected} max={8} />
        </div>
        <ChartFrame title={`Rule ${metric} by quarter`}>
          {rules.length ? <Lines data={data} series={rules} format={format} yLabel={metric[0].toUpperCase() + metric.slice(1)} height={380} /> : <p className="py-10 text-center text-sm text-muted">Select at least one rule.</p>}
        </ChartFrame>
      </Section>
      <Section title="Stability of the top rules" description="Jaccard similarity of consecutive quarters' top rule sets (1 = identical).">
        <DataTable
          rows={result.stability}
          caption="Top-rule stability"
          rowKey={(s) => `${s.a}-${s.b}`}
          columns={[
            { key: "p", header: "Quarters", render: (s) => `${s.a} to ${s.b}` },
            { key: "j", header: "Jaccard similarity", render: (s) => s.jaccard.toFixed(2), align: "right" },
          ]}
        />
      </Section>
    </>
  );
}

function Movers({ result }: { result: TemporalResult }) {
  const first = result.periods[0];
  const last = result.periods[result.periods.length - 1];
  const table = (rows: TrendRow[], caption: string) => (
    <DataTable
      rows={rows}
      caption={caption}
      rowKey={(r) => r.rule}
      pageSize={10}
      columns={[
        { key: "r", header: "Rule", render: (r) => r.rule },
        { key: "f", header: `Support ${first}`, render: (r) => fmtPct(r.supportFirst, 2), align: "right" },
        { key: "l", header: `Support ${last}`, render: (r) => fmtPct(r.supportLast, 2), align: "right" },
        { key: "c", header: "Change", render: (r) => <Pill tone={r.supportChange > 0 ? "good" : "bad"}>{Number.isFinite(r.supportChange) ? `${r.supportChange > 0 ? "+" : ""}${(r.supportChange * 100).toFixed(1)}%` : "new"}</Pill>, align: "right" },
        { key: "lift", header: "Lift first → last", render: (r) => `${fmtNum(r.liftFirst)} → ${fmtNum(r.liftLast)}`, align: "right" },
      ]}
    />
  );
  const emerging = result.trends.filter((t) => t.trend === "emerging");
  const declining = result.trends.filter((t) => t.trend === "declining").sort((a, b) => a.supportChange - b.supportChange);
  return (
    <>
      <Section title="Emerging combinations" description={`Support rose by at least 15% from ${first} to ${last}, with an upward trend across all quarters.`}>
        {emerging.length ? table(emerging, "Emerging combinations") : <p className="text-sm text-muted">None in this window.</p>}
      </Section>
      <Section title="Declining combinations" description={`Support fell by at least 15% from ${first} to ${last}, with a downward trend across all quarters.`}>
        {declining.length ? table(declining, "Declining combinations") : <p className="text-sm text-muted">None in this window.</p>}
      </Section>
      <Section>
        <Callout>
          Watch lift alongside support: a combination whose support rises while its lift falls is becoming mainstream, as its consequent spreads to postings
          without the antecedent. Falling support with rising lift means fewer postings use the stack, but those that do are more specialised.
        </Callout>
        <div className="mt-4">
          <DownloadButton
            onClick={() => download("temporal_rule_metrics.csv", toCsv(result.metrics.map((m) => ({ rule: m.rule, quarter: m.period, support: m.support, confidence: m.confidence, lift: m.lift, postings: m.count }))), "text/csv")}
          >
            Download quarterly rule metrics
          </DownloadButton>
        </div>
      </Section>
    </>
  );
}

function Compare({ result }: { result: TemporalResult }) {
  const first = result.periods[0];
  const last = result.periods[result.periods.length - 1];
  const movers = [...result.trends].sort((a, b) => Math.abs(b.supportChange) - Math.abs(a.supportChange)).slice(0, 12);
  return (
    <>
      <Section title={`Largest support shifts, ${first} vs ${last}`}>
        <ChartFrame title="Support in the first and last quarter">
          <FirstLastBars data={movers.map((m) => ({ label: m.rule, first: m.supportFirst, last: m.supportLast }))} first={first} last={last} format={(v) => fmtPct(v, 1)} />
        </ChartFrame>
      </Section>
      <Section title="Top rules in each quarter">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {result.periods.map((p) => (
            <div key={p} className="rounded-2xl border border-line bg-panel p-5">
              <p className="font-medium text-fg">{p}</p>
              <p className="text-xs text-faint">{fmtInt(result.periodSizes[p])} postings</p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted marker:text-faint">
                {result.topByPeriod[p].slice(0, 8).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
