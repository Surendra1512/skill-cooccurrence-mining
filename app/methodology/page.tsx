"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { Button, Callout, PageHeader, Panel, Section, SelectField, StatStrip, TabPanel, Tabs } from "@/components/ui";
import { useStore } from "@/lib/client/store";
import { fmtInt } from "@/lib/client/format";
import { buildUploadDataset, type ColumnMapping } from "@/lib/engine/upload";
import { PROJECT, TEAM } from "@/lib/project";

const TABS = [
  { id: "brief", label: "Project brief" },
  { id: "data", label: "Dataset" },
  { id: "prep", label: "Preprocessing" },
  { id: "method", label: "Method" },
  { id: "eval", label: "Evaluation" },
  { id: "limits", label: "Limitations" },
  { id: "upload", label: "Use your own data" },
  { id: "team", label: "Team" },
];

export default function MethodologyPage() {
  const [tab, setTab] = useState("brief");
  return (
    <>
      <PageHeader title="Data and methodology" lead="The project brief, where the data comes from, how it is cleaned and mined, how the results were checked, and what they cannot tell you." />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <TabPanel id={tab}>
        {tab === "brief" && <Brief />}
        {tab === "data" && <DatasetTab />}
        {tab === "prep" && <Preprocessing />}
        {tab === "method" && <Method />}
        {tab === "eval" && <Evaluation />}
        {tab === "limits" && <Limitations />}
        {tab === "upload" && <UploadTab />}
        {tab === "team" && <Team />}
      </TabPanel>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-4 last:border-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="text-[0.95rem] leading-relaxed text-fg">{children}</dd>
    </div>
  );
}

function Brief() {
  return (
    <Section title={PROJECT.title}>
      <Panel>
        <dl>
          <Row k="Team">
            {TEAM.members.map((m) => `${m.name} (${m.regNo})`).join(", ")}
          </Row>
          <Row k="Problem">{PROJECT.problem}</Row>
          <Row k="Users">{PROJECT.users.join(", ")}</Row>
          <Row k="Deliverables">
            <ol className="list-decimal space-y-1 pl-5 marker:text-signal-soft">
              {PROJECT.deliverables.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ol>
            <p className="mt-2">
              Baseline: {PROJECT.baseline} Deliverable: {PROJECT.deliverable}
            </p>
          </Row>
          <Row k="Technique">{PROJECT.technique}</Row>
          <Row k="Syllabus units">
            <ul className="space-y-1.5">
              {PROJECT.units.map((u) => (
                <li key={u.unit}>
                  <span className="font-medium">{u.unit}</span>, {u.topic.toLowerCase()}: <span className="text-muted">{u.where}</span>
                </li>
              ))}
            </ul>
          </Row>
          <Row k="Data">{PROJECT.data}</Row>
          <Row k="Extension">{PROJECT.extension}</Row>
          <Row k="Hackathon">
            {PROJECT.sih.event}. Problem statement {PROJECT.sih.psId}: {PROJECT.sih.theme}. Organisation: {PROJECT.sih.organisation}.{" "}
            <a href={PROJECT.sih.url} target="_blank" rel="noreferrer" className="text-signal-soft hover:underline">
              {PROJECT.sih.url}
            </a>
            . Dataset access: {PROJECT.sih.datasetAccess.toLowerCase()}.
          </Row>
          <Row k="Faculty">{TEAM.faculty}</Row>
        </dl>
      </Panel>
    </Section>
  );
}

function DatasetTab() {
  const { meta } = useStore();
  if (!meta) return null;
  const s = meta.source;
  return (
    <>
      <Section title={s.title} description={s.description}>
        <Panel>
          <dl>
            <Row k="Publisher">{s.publisher}</Row>
            <Row k="Original source">
              <a href={s.originalUrl} target="_blank" rel="noreferrer" className="text-signal-soft hover:underline">
                {s.originalUrl}
              </a>
            </Row>
            <Row k="Mirror used for download">
              <a href={s.mirrorUrl} target="_blank" rel="noreferrer" className="text-signal-soft hover:underline">
                {s.mirrorUrl}
              </a>
            </Row>
            <Row k="Licence">{s.licence}</Row>
            <Row k="Skill format">Relational: one row per posting and skill, with skill names and categories in a separate table (259 entries, 252 distinct names).</Row>
            <Row k="Coverage">
              {fmtInt(meta.report.original_records)} postings, 31 December 2022 to 31 December 2023, {fmtInt(meta.countries.length)} country labels, {meta.roles.length} roles.
            </Row>
            <Row k="Integrity">
              <ul className="space-y-1 text-sm">
                {s.files.map((f) => (
                  <li key={f.name} className="break-all">
                    {f.name} <span className="text-muted">SHA-256 {f.sha256}</span>
                  </li>
                ))}
              </ul>
            </Row>
            <Row k="Citation">
              Barousse, L. (2023). <em>data_jobs</em> [Dataset]. Hugging Face. https://huggingface.co/datasets/lukebarousse/data_jobs
            </Row>
          </dl>
        </Panel>
      </Section>
      <Section title="How the data reaches this website" description="The Python pipeline downloads the files, verifies their checksums, cleans and normalises the skills, and writes every cleaned posting into a compact file served with the site. Postings with identical skills, role, country and quarter are stored once with a count, which is exact for every analysis.">
        <StatStrip
          stats={[
            { label: "Cleaned postings shipped", value: fmtInt(meta.nTransactions) },
            { label: "Stored as weighted groups", value: fmtInt(meta.nGroups) },
            { label: "Canonical skills", value: fmtInt(meta.skills.length) },
            { label: "Quarters", value: meta.quarters.join(", ") },
          ]}
        />
      </Section>
    </>
  );
}

function Preprocessing() {
  const { dataset } = useStore();
  if (!dataset) return null;
  const r = dataset.report;
  const missing = Object.entries(r.missing_values_by_column).map(([column, n]) => ({ column, n }));
  return (
    <>
      <Section title={`Preprocessing report: ${dataset.label}`}>
        <StatStrip
          stats={[
            { label: "Original records", value: fmtInt(r.original_records) },
            { label: "Cleaned transactions", value: fmtInt(r.cleaned_records) },
            { label: "Duplicates removed", value: fmtInt(r.duplicate_records_removed) },
            { label: "Postings without skills", value: fmtInt(r.postings_without_skills_removed) },
            { label: "Unique skills", value: fmtInt(r.unique_skills) },
          ]}
        />
      </Section>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel>
          <p className="font-medium">Steps, in order</p>
          <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-muted marker:text-signal-soft">
            <li>Load postings and the posting-to-skill table, and join the skill names.</li>
            <li>Missing categorical values become “Unknown”; postings without an id are dropped.</li>
            <li>Duplicate posting ids are removed, keeping the first.</li>
            <li>
              Skill names are lower-cased, whitespace is collapsed, characters other than letters, digits and <code>+ # . / &amp; -</code> are removed (so C++, C# and Node.js stay
              distinct), and generic suffixes are stripped (“python programming” becomes “python”).
            </li>
            <li>Spelling variants of the same technology are merged with an editable synonym dictionary (powerbi → power bi, golang → go). Different technologies are never merged: AngularJS and Angular, VBA and Visual Basic, T-SQL and SQL, PySpark and Spark stay separate.</li>
            <li>Empty or meaningless tokens (no letters, placeholders such as “n/a”) are removed.</li>
            <li>Each posting becomes the set of its canonical skills; postings with no valid skill are removed.</li>
            <li>Re-posts are removed only when employer, title, location, timestamp and skill set all match.</li>
          </ol>
        </Panel>
        <div className="space-y-6">
          <Panel>
            <p className="font-medium">Transaction profile</p>
            <dl className="mt-3 space-y-2 text-sm">
              {[
                ["Skill mentions", fmtInt(r.total_skill_mentions)],
                ["Mean skills per posting", r.avg_skills_per_transaction.toFixed(2)],
                ["Median skills per posting", String(r.median_skills_per_transaction)],
                ["Single-skill postings", fmtInt(r.single_skill_transactions)],
                ["Synonym variants merged", fmtInt(r.synonym_variants_merged)],
                ["Invalid strings removed", fmtInt(r.invalid_skill_strings_removed)],
                ["Undated postings", fmtInt(r.unparseable_dates)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          {missing.length > 0 && (
            <DataTable
              rows={missing}
              caption="Missing values by column"
              rowKey={(m) => m.column}
              dense
              columns={[
                { key: "c", header: "Column", render: (m) => m.column },
                { key: "n", header: "Missing values", render: (m) => fmtInt(m.n), align: "right" },
              ]}
            />
          )}
        </div>
      </div>
    </>
  );
}

function Formula({ name, formula, text }: { name: string; formula: string; text: string }) {
  return (
    <div className="border-b border-line py-4 last:border-0">
      <p className="font-medium text-fg">
        {name} <span className="ml-2 font-normal text-signal-soft">{formula}</span>
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function Method() {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <Panel>
        <p className="font-medium">Frequent itemset mining</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          <span className="text-fg">Apriori</span> grows skill sets one skill at a time and discards any candidate with an infrequent subset, because support can only fall as a set
          grows. <span className="text-fg">FP-Growth</span> compresses postings into a prefix tree and mines it recursively without generating candidates. Both are exact and return
          identical itemsets for the same minimum support; both are implemented in TypeScript and run in a background thread in your browser.
        </p>
        <p className="mt-4 font-medium">Rule metrics</p>
        <Formula name="Support" formula="P(A ∪ B)" text="Share of postings containing every skill of the rule." />
        <Formula name="Confidence" formula="P(A ∪ B) / P(A)" text="Of postings requiring A, the share that also require B." />
        <Formula name="Lift" formula="Confidence / P(B)" text="Above 1: positive association. 1: independence. Below 1: negative association." />
        <p className="mt-3 text-sm text-muted">Rules are generated from every frequent itemset of two or more skills, so either side can hold one skill or several.</p>
      </Panel>
      <div className="space-y-6">
        <Panel>
          <p className="font-medium">Filtering and ranking</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">Rules must pass minimum support, then minimum confidence, then minimum lift. Survivors are ranked by</p>
          <p className="my-3 rounded-lg bg-ink-2 px-4 py-3 text-sm text-fg">score = w_lift · scale(log₂ lift) + w_conf · scale(confidence) + w_sup · scale(log₁₀ support)</p>
          <p className="text-sm leading-relaxed text-muted">
            Each component is min-max scaled over the surviving rules; default weights are 0.4, 0.4 and 0.2 and can be changed in Mining settings. Logarithms damp the skew of lift and
            support, and including support stops rare, high-lift rules from dominating.
          </p>
        </Panel>
        <Panel>
          <p className="font-medium">Temporal analysis</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Postings are grouped into quarters; quarters below a minimum size are excluded. Rules are mined independently in each quarter, the top rules of every quarter are tracked
            across all quarters, and a rule is emerging (or declining) when its support changes by at least 15% from the first to the last quarter with a consistent trend.
          </p>
        </Panel>
        <Panel>
          <p className="font-medium">Training recommendations</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Only rules whose antecedent the learner already has are used. Each suggested skill takes its best rule with that skill alone as the consequent, so a combination’s lift is
            never credited to one skill. A programme adds the top suggestions while at least 30 postings still require the whole combination, groups them into modules by skill category,
            and lists target roles from the matching postings. No rule means no recommendation.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Evaluation() {
  return (
    <Section title="How the results were checked">
      <Panel>
        <dl>
          <Row k="Exact agreement with Python">
            The browser miners were tested against the Python <code>mlxtend</code> library on all 670,261 postings: identical frequent itemsets and counts, identical rule counts (3,944
            generated and 1,386 surviving at the default thresholds) and identical support, confidence and lift to twelve decimal places.
          </Row>
          <Row k="Hand-verified metrics">
            On five hand-written postings, Python → SQL has support 0.60, confidence 0.75 and lift 0.9375; Tableau → Python has support 0.20, confidence 1.0 and lift 1.25. The engine
            reproduces these exactly.
          </Row>
          <Row k="Algorithm agreement">Apriori and FP-Growth run on the same input and thresholds and are compared for identical itemsets, supports and surviving rules (Association rules page).</Row>
          <Row k="Filtering transparency">The number of rules left after each threshold is reported with every run.</Row>
          <Row k="Stability">Top rule sets of consecutive quarters are compared with Jaccard similarity.</Row>
          <Row k="Baseline comparison">Pairs of the most frequent skills are compared with the joint support expected under independence (Skill analysis page).</Row>
          <Row k="Automated tests">65 TypeScript tests and 87 Python tests cover loading, normalisation, cleaning, mining, metrics, filtering, ranking, temporal analysis and recommendations.</Row>
        </dl>
      </Panel>
    </Section>
  );
}

function Limitations() {
  const items: [string, string][] = [
    ["Sector", "The verified dataset covers data and technology roles. It does not describe cooperative, agricultural or rural-finance vacancies; findings describe this labour market only. Organisations can analyse their own postings with Use your own data."],
    ["Country labels", "Country labels are partly unreliable: the 21,519 raw postings labelled Sudan are mostly US jobs labelled with the collector’s search location. Country views are illustrative."],
    ["Time window", "One year (2023). Temporal results are quarter-to-quarter shifts inside that year, not long-run trends."],
    ["Skill extraction", "Skills were extracted by the publisher with a fixed list of 259 technical terms. Soft skills and other terms are absent, and a few terms (flow, unity, planner) can match non-technical wording. 14.9% of postings had no extracted skill and are excluded."],
    ["No industry field", "Industry-wise analysis is replaced by role and country breakdowns."],
    ["Association is not causation", "Rules describe which skills employers ask for together, not that learning one leads to needing the other, and not employment outcomes."],
    ["Threshold choice", "Results depend on the thresholds and ranking weights; scores are comparable within one run only. No statistical significance test is applied."],
    ["Curated parts", "The synonym dictionary and prerequisite list are maintained by hand."],
  ];
  return (
    <Section title="What the results cannot tell you">
      <Panel>
        <dl>
          {items.map(([k, v]) => (
            <Row key={k} k={k}>
              {v}
            </Row>
          ))}
        </dl>
      </Panel>
    </Section>
  );
}

const NONE = "";

function guess(columns: string[], names: string[]): string {
  return columns.find((c) => names.includes(c.toLowerCase().trim())) ?? NONE;
}

function UploadTab() {
  const { meta, addDataset } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ skills: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const onFile = (f: File | null) => {
    setError(null);
    setDone(null);
    setFile(f);
    setRows([]);
    if (!f) return;
    Papa.parse<Record<string, unknown>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (res.errors.length && res.data.length === 0) {
          setError(`Could not read the CSV: ${res.errors[0].message}`);
          return;
        }
        const cols = res.meta.fields ?? [];
        setColumns(cols);
        setRows(res.data);
        setMapping({
          skills: guess(cols, ["skills", "job_skills", "skill_list", "key skills", "key_skills"]),
          jobId: guess(cols, ["job_id", "id"]) || undefined,
          role: guess(cols, ["role", "job_title_short", "category", "functional area"]) || undefined,
          title: guess(cols, ["title", "job_title"]) || undefined,
          date: guess(cols, ["date", "posted_at", "job_posted_date", "posting_date"]) || undefined,
          country: guess(cols, ["country", "state", "job_country"]) || undefined,
          company: guess(cols, ["company", "company_id", "employer"]) || undefined,
          location: guess(cols, ["location", "job_location", "district"]) || undefined,
        });
      },
      error: (e) => setError(`Could not read the CSV: ${e.message}`),
    });
  };

  const field = (key: keyof ColumnMapping, label: string, required = false) => (
    <SelectField
      label={label}
      value={mapping[key] ?? NONE}
      options={[{ value: NONE, label: required ? "Choose a column" : "Not available" }, ...columns.map((c) => ({ value: c, label: c }))]}
      onChange={(v) => setMapping({ ...mapping, [key]: v || undefined, ...(key === "skills" ? { skills: v } : {}) })}
    />
  );

  const process = async () => {
    if (!file || !meta) return;
    if (!mapping.skills) {
      setError("Choose the column that holds the skills.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ds = buildUploadDataset(rows, mapping, file.name, meta.synonyms, meta.displayNames, meta.prerequisites);
      await addDataset(ds);
      setDone(`Processed ${fmtInt(ds.report.cleaned_records)} postings with ${fmtInt(ds.skills.length)} skills. “${ds.label}” is now selected at the top of the page; every page now analyses this file.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Analyse your own vacancy data"
      description="Upload a CSV of job postings, for example a cooperative society's vacancy records. It is processed entirely in your browser with the same cleaning, mining, temporal and planning steps; nothing is uploaded to a server."
    >
      <Panel tone="raised">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-2 bg-ink-2 px-6 py-8 text-center hover:border-signal/60">
          <Upload size={22} className="text-signal-soft" aria-hidden />
          <span className="text-sm text-fg">{file ? file.name : "Choose a CSV file"}</span>
          <span className="text-xs text-muted">Only a skills column is required. Skills can be a list (['a', 'b']) or separated by ; | or ,</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
        {rows.length > 0 && (
          <>
            <p className="mt-6 text-sm text-muted">
              {fmtInt(rows.length)} rows and {columns.length} columns found. Match the columns:
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {field("skills", "Skills (required)", true)}
              {field("jobId", "Posting id")}
              {field("role", "Role or job category")}
              {field("date", "Posting date")}
              {field("country", "Country or state")}
              {field("company", "Employer")}
              {field("title", "Job title")}
              {field("location", "Location")}
            </div>
            <div className="mt-6">
              <Button variant="primary" onClick={process} disabled={busy}>
                {busy ? "Processing…" : "Process dataset"}
              </Button>
            </div>
          </>
        )}
        {error && (
          <div className="mt-4">
            <Callout tone="warn">{error}</Callout>
          </div>
        )}
        {done && (
          <div className="mt-4">
            <Callout>{done}</Callout>
          </div>
        )}
      </Panel>
    </Section>
  );
}

function Team() {
  return (
    <Section title="Team">
      <div className="grid gap-4 md:grid-cols-3">
        {TEAM.members.map((m) => (
          <Panel key={m.regNo}>
            <p className="text-lg font-semibold">{m.name}</p>
            <p className="mt-1 text-sm text-muted">Registration number {m.regNo}</p>
            <p className="mt-3 text-sm text-muted">
              {TEAM.department}
              <br />
              {TEAM.university}, {TEAM.location}
            </p>
          </Panel>
        ))}
        <Panel tone="flat">
          <p className="text-lg font-semibold">{TEAM.faculty}</p>
          <p className="mt-1 text-sm text-muted">Faculty</p>
          <p className="mt-3 text-sm text-muted">{TEAM.university}</p>
        </Panel>
      </div>
    </Section>
  );
}
