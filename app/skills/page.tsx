"use client";

import { useMemo, useState } from "react";
import { ChartFrame, HBar, Heatmap, Lines, VBar } from "@/components/charts";
import { DataTable } from "@/components/DataTable";
import { Callout, DataToggle, DownloadButton, PageHeader, Section, Segmented, SelectField, TabPanel, Tabs } from "@/components/ui";
import { WithMining } from "@/components/WithMining";
import { useStore } from "@/lib/client/store";
import { download, fmtInt, fmtNum, fmtPct, toCsv } from "@/lib/client/format";
import { baselinePairs, segmentFrequency, segmentSizes, sizeDistribution, type FrequencyRow } from "@/lib/engine/frequency";
import type { TraceRow } from "@/lib/engine/types";

const TABS = [
  { id: "frequency", label: "Frequency" },
  { id: "segments", label: "By role and country" },
  { id: "explorer", label: "Skill explorer" },
  { id: "baseline", label: "Baseline vs association" },
  { id: "cleaned", label: "Cleaned skills" },
];

export default function SkillsPage() {
  const [tab, setTab] = useState("frequency");
  return (
    <>
      <PageHeader
        title="Skill analysis"
        lead="The mandatory baseline: how often each individual skill is requested. It describes demand for single skills, and the comparison tab shows why it cannot reveal how skills combine."
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <TabPanel id={tab}>
        {tab === "frequency" && <FrequencyTab />}
        {tab === "segments" && <SegmentsTab />}
        {tab === "explorer" && <ExplorerTab />}
        {tab === "baseline" && <BaselineTab />}
        {tab === "cleaned" && <CleanedTab />}
      </TabPanel>
    </>
  );
}

function FrequencyTab() {
  const { frequency, label, tx, dataset } = useStore();
  const [topN, setTopN] = useState<10 | 20 | 30>(20);
  const top = frequency.slice(0, topN);
  const sizes = useMemo(() => (tx ? sizeDistribution(tx) : []), [tx]);
  const ranks = frequency.map((f) => ({ x: String(f.rank), value: f.postings, tip: [{ label: label(f.id), value: `${fmtInt(f.postings)} postings` }] }));
  if (!tx || !dataset) return null;

  return (
    <>
      <Section
        title={`Top ${topN} skills`}
        description={`Share of ${fmtInt(tx.total)} postings in scope that require each skill.`}
        actions={
          <>
            <Segmented label="Number of skills" options={[10, 20, 30] as const} value={topN} onChange={setTopN} format={(v) => `Top ${v}`} />
            <DownloadButton
              onClick={() =>
                download(
                  "skill_frequency.csv",
                  toCsv(frequency.map((f) => ({ rank: f.rank, skill: label(f.id), category: dataset.skills[f.id].category, postings: f.postings, share: f.share }))),
                  "text/csv",
                )
              }
            >
              Download CSV
            </DownloadButton>
          </>
        }
      >
        <ChartFrame title={`Top ${topN} individual skills`}>
          <HBar data={top.map((f) => ({ label: label(f.id), value: f.share, tip: [{ label: "Share", value: fmtPct(f.share) }, { label: "Postings", value: fmtInt(f.postings) }] }))} format={(v) => fmtPct(v, 0)} />
          <DataToggle>
            <FrequencyTable rows={top} />
          </DataToggle>
        </ChartFrame>
      </Section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartFrame title="Long tail of skills" subtitle="Postings per skill by frequency rank. A few skills dominate; most are niche.">
          <VBar data={ranks} xLabel="Rank" yFormat={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : fmtInt(v))} />
        </ChartFrame>
        <ChartFrame title="Skills per posting" subtitle={`Mean ${fmtNum(dataset.report.avg_skills_per_transaction)} skills per cleaned posting.`}>
          <VBar data={sizes.slice(0, 25).map((s) => ({ x: String(s.size), value: s.postings }))} xLabel="Skills in posting" yFormat={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : fmtInt(v))} />
        </ChartFrame>
      </div>
      <TemporalSkillPreview />
    </>
  );
}

function FrequencyTable({ rows }: { rows: FrequencyRow[] }) {
  const { label, dataset } = useStore();
  return (
    <DataTable
      rows={rows}
      caption="Skill frequency"
      rowKey={(r) => String(r.id)}
      pageSize={30}
      dense
      columns={[
        { key: "rank", header: "Rank", render: (r) => r.rank, sortValue: (r) => -r.rank, align: "right", width: "4rem" },
        { key: "skill", header: "Skill", render: (r) => label(r.id), sortValue: (r) => label(r.id) },
        { key: "cat", header: "Category", render: (r) => <span className="text-muted">{dataset?.skills[r.id].category}</span> },
        { key: "postings", header: "Postings", render: (r) => fmtInt(r.postings), sortValue: (r) => r.postings, align: "right" },
        { key: "share", header: "Share", render: (r) => fmtPct(r.share), sortValue: (r) => r.share, align: "right" },
      ]}
    />
  );
}

function SegmentsTab() {
  const { dataset, scope, frequency, label } = useStore();
  const [dimension, setDimension] = useState<"Job role" | "Country">("Job role");
  const cells = useMemo(() => {
    if (!dataset) return null;
    const dim = dimension === "Job role" ? "role" : "country";
    const segs = segmentSizes(dataset.groups, scope, dim).slice(0, 12);
    const skills = frequency.slice(0, 15).map((f) => f.id);
    const data = segmentFrequency(dataset.groups, scope, dim, skills, segs.map((s) => s[0]));
    const names = dim === "role" ? dataset.roles : dataset.countries;
    return {
      rows: segs.map((s) => `${names[s[0]]} (${fmtInt(s[1])})`),
      cols: skills.map(label),
      values: segs.map((_, r) => skills.map((_, c) => data[r * skills.length + c].share)),
      counts: segs.map((_, r) => skills.map((_, c) => data[r * skills.length + c].postings)),
    };
  }, [dataset, scope, frequency, label, dimension]);
  if (!cells) return null;
  return (
    <Section
      title="Skill demand by segment"
      description="The dataset has no industry field, so job role and country are the available segments. Each cell is the share of that segment's postings requiring the skill."
      actions={<Segmented label="Segment by" options={["Job role", "Country"] as const} value={dimension} onChange={setDimension} />}
    >
      <ChartFrame title={`Top 15 skills by ${dimension.toLowerCase()}`} subtitle="Largest 12 segments in the current scope.">
        <Heatmap
          rows={cells.rows}
          cols={cells.cols}
          values={cells.values}
          format={(v) => fmtPct(v, 0)}
          cellTip={(r, c) => [{ label: "Share of segment", value: fmtPct(cells.values[r][c]) }, { label: "Postings", value: fmtInt(cells.counts[r][c]) }]}
        />
      </ChartFrame>
      {dimension === "Country" && (
        <div className="mt-4">
          <Callout tone="warn">
            Country labels come from the source data and are partly unreliable: postings labelled Sudan are mostly US jobs labelled with the
            collector&apos;s search location. Treat country breakdowns as illustrative.
          </Callout>
        </div>
      )}
    </Section>
  );
}

function ExplorerTab() {
  const { dataset, frequency, label, tx } = useStore();
  const [skill, setSkill] = useState<number>(frequency[0]?.id ?? 0);
  const [order, setOrder] = useState<"Postings together" | "Lift (≥ 100 postings)">("Postings together");

  const rows = useMemo(() => {
    if (!tx) return [];
    const joint = new Float64Array(tx.nItems);
    let nSkill = 0;
    for (let t = 0; t < tx.weights.length; t++) {
      let has = false;
      for (let i = tx.offsets[t]; i < tx.offsets[t + 1]; i++) if (tx.items[i] === skill) has = true;
      if (!has) continue;
      nSkill += tx.weights[t];
      for (let i = tx.offsets[t]; i < tx.offsets[t + 1]; i++) joint[tx.items[i]] += tx.weights[t];
    }
    const share = new Map(frequency.map((f) => [f.id, f.share]));
    const out = [];
    for (let s = 0; s < tx.nItems; s++) {
      if (s === skill || joint[s] === 0) continue;
      const confidence = joint[s] / nSkill;
      out.push({ id: s, together: joint[s], confidence, lift: confidence / (share.get(s) ?? 1) });
    }
    return out;
  }, [tx, skill, frequency]);

  if (!dataset) return null;
  const row = frequency.find((f) => f.id === skill);
  const meta = dataset.skills[skill];
  const sorted = order === "Postings together" ? [...rows].sort((a, b) => b.together - a.together) : rows.filter((r) => r.together >= 100).sort((a, b) => b.lift - a.lift);

  return (
    <Section title="Skill explorer" description="Pick any skill to see how often it is requested and which skills appear alongside it.">
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SelectField label="Skill" value={skill} options={frequency.map((f) => ({ value: f.id, label: `${label(f.id)} (${fmtPct(f.share)})` }))} onChange={setSkill} />
          {row && (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
              {[
                ["Postings", fmtInt(row.postings)],
                ["Share", fmtPct(row.share)],
                ["Rank", `#${row.rank}`],
                ["Category", meta.category],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel p-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="mt-0.5 font-medium text-fg">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs leading-relaxed text-faint">Raw spellings merged into this skill: {meta.variants}</p>
        </div>
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Skills requested alongside {label(skill)}</p>
            <Segmented label="Order by" options={["Postings together", "Lift (≥ 100 postings)"] as const} value={order} onChange={setOrder} />
          </div>
          <DataTable
            rows={sorted.slice(0, 40)}
            pageSize={12}
            caption={`Skills co-occurring with ${label(skill)}`}
            rowKey={(r) => String(r.id)}
            columns={[
              { key: "s", header: "Skill", render: (r) => label(r.id) },
              { key: "t", header: "Postings together", render: (r) => fmtInt(r.together), align: "right" },
              { key: "c", header: `Share of ${label(skill)} postings`, render: (r) => fmtPct(r.confidence), align: "right" },
              { key: "l", header: "Lift", render: (r) => fmtNum(r.lift), align: "right" },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

function BaselineTab() {
  const { tx, frequency, label, setLabel } = useStore();
  const [topN, setTopN] = useState(10);
  const pairs = useMemo(() => (tx ? baselinePairs(tx, frequency, topN) : []), [tx, frequency, topN]);
  const below = pairs.filter((p) => p.lift < 1).length;
  const independent = pairs.filter((p) => p.lift >= 0.9 && p.lift <= 1.1).length;
  const strong = pairs.filter((p) => p.lift >= 1.2).length;

  return (
    <>
      <Section
        title="Why frequency alone is not enough"
        description="A frequency-only planner would bundle the most requested skills. Here each pair of top skills is checked against the joint support expected if employers chose them independently."
        actions={<SelectField label="Top skills to pair" value={topN} options={[5, 8, 10, 15, 20].map((v) => ({ value: v, label: `Top ${v} skills` }))} onChange={setTopN} />}
      >
        <Callout>
          Of the {pairs.length} pairs formed by the {topN} most frequent skills, <strong>{below}</strong> appear together less often than chance (lift below
          1), <strong>{independent}</strong> are essentially independent (lift 0.9–1.1) and only <strong>{strong}</strong> reach lift 1.2.
        </Callout>
        <div className="mt-5">
          <DataTable
            rows={pairs}
            pageSize={12}
            caption="Baseline pairs"
            rowKey={(p) => `${p.a}-${p.b}`}
            initialSort={{ key: "score", desc: true }}
            columns={[
              { key: "pair", header: "Pair", render: (p) => `${label(p.a)} + ${label(p.b)}` },
              { key: "score", header: "Baseline score", render: (p) => fmtNum(p.baselineScore, 3), sortValue: (p) => p.baselineScore, align: "right", title: "Share A + share B" },
              { key: "exp", header: "Expected if independent", render: (p) => fmtPct(p.expectedSupport, 2), sortValue: (p) => p.expectedSupport, align: "right" },
              { key: "obs", header: "Observed together", render: (p) => fmtPct(p.observedSupport, 2), sortValue: (p) => p.observedSupport, align: "right" },
              {
                key: "lift",
                header: "Lift",
                render: (p) => <span className={p.lift < 1 ? "text-bad" : p.lift >= 1.2 ? "text-[#3fd25a]" : "text-muted"}>{fmtNum(p.lift)}</span>,
                sortValue: (p) => p.lift,
                align: "right",
              },
              { key: "n", header: "Postings together", render: (p) => fmtInt(p.together), sortValue: (p) => p.together, align: "right" },
            ]}
          />
        </div>
      </Section>
      <WithMining>
        {(result) => {
          const topSet = new Set(frequency.slice(0, 10).map((f) => f.id));
          const top50 = result.ranked.slice(0, 50);
          const outside = top50.filter((r) => [...r.antecedent, ...r.consequent].some((s) => !topSet.has(s)));
          return (
            <Section
              title="What association mining finds that frequency misses"
              description={`${outside.length} of the top ${top50.length} ranked rules involve at least one skill outside the 10 most frequent. A frequency ranking would never surface these combinations.`}
            >
              <DataTable
                rows={outside.slice(0, 10)}
                pageSize={10}
                caption="Rules outside the top-10 skills"
                rowKey={(r) => `${r.antecedent}>${r.consequent}`}
                columns={[
                  { key: "rank", header: "Rank", render: (r) => r.rank, align: "right", width: "4rem" },
                  { key: "rule", header: "Rule", render: (r) => `${setLabel(r.antecedent)} → ${setLabel(r.consequent)}` },
                  { key: "conf", header: "Confidence", render: (r) => fmtPct(r.confidence), align: "right" },
                  { key: "lift", header: "Lift", render: (r) => fmtNum(r.lift), align: "right" },
                  { key: "n", header: "Postings", render: (r) => fmtInt(r.count), align: "right" },
                ]}
              />
            </Section>
          );
        }}
      </WithMining>
    </>
  );
}

function CleanedTab() {
  const { dataset } = useStore();
  const [status, setStatus] = useState<"all" | "kept" | "mapped_synonym" | "removed_invalid">("all");
  if (!dataset) return null;
  const trace = status === "all" ? dataset.trace : dataset.trace.filter((t) => t[3] === status);
  const r = dataset.report;
  return (
    <>
      <Section
        title="Normalisation trace"
        description="Every raw skill string in the source, its cleaned form and the canonical skill it became. Any result on this site can be traced back to the original text."
        actions={
          <>
            <SelectField
              label="Status"
              hideLabel
              value={status}
              options={[
                { value: "all", label: "All statuses" },
                { value: "kept", label: "Kept as is" },
                { value: "mapped_synonym", label: "Merged synonym" },
                { value: "removed_invalid", label: "Removed as invalid" },
              ]}
              onChange={setStatus}
            />
            <DownloadButton onClick={() => download("normalisation_trace.csv", toCsv(dataset.trace.map(([raw, cleaned, canonical, st, n]) => ({ raw, cleaned, canonical: canonical ?? "", status: st, occurrences: n }))), "text/csv")}>
              Download trace
            </DownloadButton>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted">
          {fmtInt(r.distinct_raw_skill_strings)} raw strings, {fmtInt(r.synonym_variants_merged)} merged as synonyms, {fmtInt(r.invalid_skill_strings_removed)} removed,{" "}
          {fmtInt(r.unique_skills)} canonical skills.
        </p>
        <DataTable<TraceRow>
          rows={trace}
          pageSize={15}
          caption="Normalisation trace"
          rowKey={(t) => t[0]}
          initialSort={{ key: "n", desc: true }}
          columns={[
            { key: "raw", header: "Raw string", render: (t) => t[0], sortValue: (t) => t[0] },
            { key: "clean", header: "Cleaned", render: (t) => <span className="text-muted">{t[1]}</span> },
            { key: "canon", header: "Canonical skill", render: (t) => t[2] ?? <span className="text-bad">removed</span>, sortValue: (t) => t[2] ?? "" },
            { key: "status", header: "Status", render: (t) => (t[3] === "mapped_synonym" ? <span className="text-signal-soft">merged synonym</span> : t[3] === "kept" ? "kept" : <span className="text-bad">invalid</span>), sortValue: (t) => t[3] },
            { key: "n", header: "Occurrences", render: (t) => fmtInt(t[4]), sortValue: (t) => t[4], align: "right" },
          ]}
        />
      </Section>
    </>
  );
}

/** Quarterly share of the top skills (time-wise baseline). */
function TemporalSkillPreview() {
  const { dataset, scope, frequency, label } = useStore();
  const data = useMemo(() => {
    if (!dataset || dataset.quarters.length < 2) return null;
    const skills = frequency.slice(0, 6).map((f) => f.id);
    const quarters = dataset.quarters.map((_, i) => i);
    const cells = segmentFrequency(dataset.groups, scope, "quarter", skills, quarters);
    const sizes = new Map(segmentSizes(dataset.groups, scope, "quarter"));
    const dated = [...sizes.entries()].filter(([q]) => q !== 255).reduce((s, [, n]) => s + n, 0);
    const minSize = Math.max(200, Math.min(5000, Math.round((dated * 0.02) / 100) * 100));
    const big = quarters.filter((q) => (sizes.get(q) ?? 0) >= minSize);
    return {
      series: skills.map(label),
      rows: big.map((q) => {
        const row: Record<string, number | string> = { period: dataset.quarters[q] };
        skills.forEach((s, k) => (row[label(s)] = cells[quarters.indexOf(q) * skills.length + k].share));
        return row;
      }),
    };
  }, [dataset, scope, frequency, label]);
  if (!data || data.rows.length < 2) return null;
  return (
    <Section title="Time-wise skill frequency" description="Quarterly share of postings requiring the six most frequent skills (quarters too small to be reliable are left out, as on the temporal page).">
      <ChartFrame title="Top skills by quarter">
        <Lines data={data.rows} series={data.series} format={(v) => fmtPct(v, 0)} yLabel="Share" />
      </ChartFrame>
    </Section>
  );
}

