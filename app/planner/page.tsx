"use client";

import { useMemo, useState } from "react";
import { ChartFrame, HBar, PairedBars } from "@/components/charts";
import { DataTable } from "@/components/DataTable";
import { MultiSelect } from "@/components/MultiSelect";
import { RulesTable, rulesCsv } from "@/components/RulesTable";
import { Callout, DownloadButton, PageHeader, Panel, Section, SelectField, SliderField, TabPanel, Tabs } from "@/components/ui";
import { WithMining } from "@/components/WithMining";
import { useStore } from "@/lib/client/store";
import { download, fmtInt, fmtNum, fmtPct, toCsv } from "@/lib/client/format";
import { filterRules, generateRules, rankRules } from "@/lib/engine/rules";
import { recommend, roleSkillGap, type RecommendationResult } from "@/lib/engine/recommend";
import type { MiningResult } from "@/lib/engine/types";

const TABS = [
  { id: "recs", label: "Complementary skills" },
  { id: "programme", label: "Combined programme" },
  { id: "gap", label: "Role skill gap" },
  { id: "evidence", label: "Supporting rules" },
];

const DISCLAIMER = "Recommendations show which skills employers request together in the analysed postings. They describe demand, not guaranteed employment outcomes.";

export default function PlannerPage() {
  return (
    <>
      <PageHeader
        title="Training planner"
        lead="Choose the skills a learner already has. The planner finds what employers who want those skills also ask for, and builds a combined programme from the mined rules."
      />
      <p className="mt-4 text-sm text-faint">{DISCLAIMER}</p>
      <WithMining>{(result) => <Planner result={result} />}</WithMining>
    </>
  );
}

function Planner({ result }: { result: MiningResult }) {
  const { dataset, scope, frequency, label, weights } = useStore();
  const python = dataset?.skills.findIndex((s) => s.key === "python") ?? -1;
  const [selected, setSelected] = useState<number[]>(python >= 0 ? [python] : frequency.slice(0, 1).map((f) => f.id));
  const [minConf, setMinConf] = useState(result.config.minConfidence);
  const [minLift, setMinLift] = useState(Math.max(1, result.config.minLift));
  const [tab, setTab] = useState("recs");

  // Rules for the planner: the mined set, or the same itemsets re-filtered at the planner's evidence thresholds.
  const rules = useMemo(() => {
    if (minConf === result.config.minConfidence && minLift === result.config.minLift) return result.ranked;
    const all = generateRules(result.itemsets, result.total);
    return rankRules(filterRules(all, result.config.minSupport, minConf, minLift).rules, weights);
  }, [result, minConf, minLift, weights]);

  const rec = useMemo<RecommendationResult | null>(
    () => (dataset && selected.length ? recommend(selected, rules, dataset.groups, scope, dataset.skills, dataset.prerequisites) : null),
    [dataset, selected, rules, scope],
  );
  if (!dataset) return null;

  return (
    <>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel tone="raised">
          <MultiSelect
            label="Learner's existing skills"
            options={frequency.map((f) => ({ value: f.id, label: label(f.id), hint: fmtPct(f.share, 0) }))}
            value={selected}
            onChange={setSelected}
            placeholder="Type a skill, e.g. Excel"
          />
        </Panel>
        <Panel>
          <p className="mb-4 text-sm text-fg">Evidence thresholds</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <SliderField label="Minimum confidence" value={minConf} min={0.05} max={0.95} step={0.05} format={(v) => fmtPct(v, 0)} onChange={setMinConf} />
            <SliderField label="Minimum lift" value={minLift} min={1} max={5} step={0.05} format={(v) => v.toFixed(2)} onChange={setMinLift} />
          </div>
          <p className="mt-3 text-xs leading-snug text-faint">Applied to rules from the current mining run (support ≥ {fmtPct(result.config.minSupport, 1)}). Lift stays at 1 or above so only positive associations are used.</p>
        </Panel>
      </div>

      {!rec && <div className="mt-6"><Callout>Select at least one skill to see recommendations.</Callout></div>}
      {rec && (
        <>
          {rec.messages.map((m) => (
            <div key={m} className="mt-6">
              <Callout tone="warn">{m}</Callout>
            </div>
          ))}
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <TabPanel id={tab}>
            {tab === "recs" && <Recommendations rec={rec} />}
            {tab === "programme" && <Programme rec={rec} selected={selected} />}
            {tab === "gap" && <Gap selected={selected} />}
            {tab === "evidence" && <Evidence rec={rec} />}
          </TabPanel>
        </>
      )}
    </>
  );
}

function Recommendations({ rec }: { rec: RecommendationResult }) {
  const { label, setLabel, dataset } = useStore();
  if (rec.recommendations.length === 0) return null;
  return (
    <>
      {rec.recommendations.length < 3 && (
        <div className="mt-6">
          <Callout>Few rules qualify at these thresholds. Lowering the evidence thresholds will surface more, weaker associations.</Callout>
        </div>
      )}
      <Section>
        <ul className="grid gap-3 md:grid-cols-2">
          {rec.recommendations.map((r, i) => (
            <li key={r.skill} className="rounded-2xl border border-line bg-panel p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-faint">Suggestion {i + 1}</p>
                  <p className="text-lg font-semibold text-fg">{label(r.skill)}</p>
                  <p className="text-xs text-muted">{dataset?.skills[r.skill].category.replace("_", " ")}</p>
                </div>
                <dl className="grid grid-cols-3 gap-4 text-right">
                  <div>
                    <dt className="text-xs text-muted">Confidence</dt>
                    <dd className="font-semibold">{fmtPct(r.confidence, 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Lift</dt>
                    <dd className="font-semibold">{fmtNum(r.lift)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Postings</dt>
                    <dd className="font-semibold">{fmtInt(r.count)}</dd>
                  </div>
                </dl>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Of {fmtInt(r.antecedentCount)} postings requiring {setLabel(r.rule.antecedent)}, {fmtPct(r.confidence, 0)} also require {setLabel(r.rule.consequent)}, which is{" "}
                {fmtNum(r.lift)}× the rate in all postings. Based on {r.supportingRules} supporting rule{r.supportingRules === 1 ? "" : "s"}.
              </p>
            </li>
          ))}
        </ul>
      </Section>
      <Section>
        <ChartFrame title="Complementary skills compared">
          <PairedBars
            data={rec.recommendations.map((r) => ({ label: label(r.skill), left: r.confidence, right: r.lift }))}
            leftLabel="Confidence"
            rightLabel="Lift (dashed line: independence)"
            leftFormat={(v) => fmtPct(v, 0)}
            rightFormat={(v) => fmtNum(v, 1)}
            rightReference={1}
          />
        </ChartFrame>
        <div className="mt-4">
          <DownloadButton
            onClick={() =>
              download(
                "skill_recommendations.csv",
                toCsv(rec.recommendations.map((r) => ({ skill: label(r.skill), confidence: r.confidence, lift: r.lift, support: r.support, postings: r.count, supporting_rules: r.supportingRules, best_rule: `${setLabel(r.rule.antecedent)} -> ${setLabel(r.rule.consequent)}` }))),
                "text/csv",
              )
            }
          >
            Download recommendations
          </DownloadButton>
        </div>
      </Section>
    </>
  );
}

function Programme({ rec, selected }: { rec: RecommendationResult; selected: number[] }) {
  const { label, setLabel, dataset, scopeText, config } = useStore();
  const p = rec.programme;
  if (!p) return <div className="mt-6"><Callout>No combined programme reaches the minimum of 30 postings requiring the full combination for this selection.</Callout></div>;
  return (
    <>
      <Section>
        <Panel tone="raised">
          <p className="text-sm text-muted">Combined programme</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-fg">{p.skills.map(label).join(" + ")}</p>
          <p className="mt-2 text-sm text-muted">
            Builds on {setLabel(selected)} and adds {p.added.map(label).join(", ")}.
          </p>
          <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            {[
              ["Postings requiring the full combination", fmtInt(p.postings)],
              ["Share of all postings in scope", fmtPct(p.shareOfAll, 2)],
              ["Share of postings requiring the learner's skills", p.shareOfLearner === null ? "—" : fmtPct(p.shareOfLearner)],
            ].map(([k, v]) => (
              <div key={k} className="bg-panel p-4">
                <dt className="text-sm text-muted">{k}</dt>
                <dd className="mt-1 text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </Section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Panel>
            <p className="font-medium text-fg">Suggested training modules</p>
            <ol className="mt-3 space-y-2 text-sm">
              {p.modules.map((m, i) => (
                <li key={m.module} className="flex gap-3">
                  <span className="text-signal-soft">{i + 1}</span>
                  <span>
                    <span className="text-fg">{m.module}</span>
                    <span className="text-muted">: {m.skills.map(label).join(", ")}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel>
            <p className="font-medium text-fg">Prerequisites</p>
            <p className="mt-1 text-xs text-faint">Widely accepted technical dependencies (curated domain knowledge, not mined).</p>
            {p.prerequisites.length ? (
              <ul className="mt-3 space-y-1.5 text-sm">
                {p.prerequisites.map((r) => (
                  <li key={`${r.skill}-${r.prerequisite}`} className="flex justify-between gap-3">
                    <span className="text-muted">
                      {label(r.skill)} needs {r.prerequisite}
                    </span>
                    <span className={r.status === "learn first" ? "text-warn" : "text-[#3fd25a]"}>{r.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">No recorded prerequisites for the added skills.</p>
            )}
          </Panel>
        </div>
        <ChartFrame title="Target roles for this combination" subtitle="Roles of the postings that require every skill in the programme.">
          <HBar
            data={p.roles.map((r) => ({
              label: dataset!.roles[r.role],
              value: r.share,
              tip: [
                { label: "Share of matching postings", value: fmtPct(r.share) },
                { label: "Postings", value: fmtInt(r.postings) },
                { label: "Versus overall share", value: `${fmtNum(r.ratio)}×` },
              ],
            }))}
            format={(v) => fmtPct(v, 0)}
            labelWidth={170}
          />
        </ChartFrame>
      </div>
      <Section>
        <DownloadButton
          onClick={() =>
            download(
              "training_programme.json",
              JSON.stringify(
                {
                  generated_on: new Date().toISOString().slice(0, 10),
                  dataset: dataset!.label,
                  scope: scopeText,
                  mining_config: config,
                  learner_skills: selected.map(label),
                  programme_skills: p.skills.map(label),
                  postings_with_full_combination: p.postings,
                  share_of_all_postings: p.shareOfAll,
                  share_of_learner_postings: p.shareOfLearner,
                  modules: p.modules.map((m) => ({ module: m.module, skills: m.skills.map(label) })),
                  prerequisites: p.prerequisites.map((r) => ({ skill: label(r.skill), prerequisite: r.prerequisite, status: r.status })),
                  target_roles: p.roles.map((r) => ({ role: dataset!.roles[r.role], postings: r.postings, share: r.share, ratio_to_overall: r.ratio })),
                  recommendations: rec.recommendations.map((r) => ({ skill: label(r.skill), confidence: r.confidence, lift: r.lift, postings: r.count, rule: `${setLabel(r.rule.antecedent)} -> ${setLabel(r.rule.consequent)}` })),
                  disclaimer: DISCLAIMER,
                },
                null,
                2,
              ),
              "application/json",
            )
          }
        >
          Download programme (JSON)
        </DownloadButton>
      </Section>
    </>
  );
}

function Gap({ selected }: { selected: number[] }) {
  const { dataset, scope, label } = useStore();
  const roles = useMemo(() => (dataset ? dataset.roles.map((r, i) => ({ value: i, label: r })) : []), [dataset]);
  const [role, setRole] = useState(0);
  const gap = useMemo(() => (dataset ? roleSkillGap(selected, role, dataset.groups, scope, dataset.skills.length) : []), [dataset, selected, role, scope]);
  if (!dataset) return null;
  return (
    <Section title="Skills a target role asks for that the learner lacks" description="Ranked by how many postings for the role require each skill.">
      <div className="mb-4 max-w-sm">
        <SelectField label="Target role" value={role} options={roles} onChange={setRole} />
      </div>
      {gap.length === 0 ? (
        <p className="text-sm text-muted">No postings for this role in the current scope.</p>
      ) : (
        <DataTable
          rows={gap}
          caption="Role skill gap"
          rowKey={(g) => String(g.skill)}
          columns={[
            { key: "s", header: "Missing skill", render: (g) => label(g.skill) },
            { key: "r", header: `Share of ${dataset.roles[role]} postings`, render: (g) => fmtPct(g.shareInRole), align: "right" },
            { key: "o", header: "Share of all postings", render: (g) => fmtPct(g.shareOverall), align: "right" },
            { key: "x", header: "Over-representation", render: (g) => `${fmtNum(g.ratio)}×`, align: "right" },
            { key: "n", header: "Postings", render: (g) => fmtInt(g.postings), align: "right" },
          ]}
        />
      )}
      <div className="mt-4">
        <DownloadButton onClick={() => download("role_skill_gap.csv", toCsv(gap.map((g) => ({ role: dataset.roles[role], skill: label(g.skill), share_in_role: g.shareInRole, share_overall: g.shareOverall, ratio: g.ratio, postings: g.postings }))), "text/csv")} disabled={gap.length === 0}>
          Download skill gap
        </DownloadButton>
      </div>
    </Section>
  );
}

function Evidence({ rec }: { rec: RecommendationResult }) {
  const { setLabel } = useStore();
  return (
    <Section title="Supporting rules" description={`${fmtInt(rec.evidence.length)} mined rules start from the selected skills and add at least one new skill.`}>
      <RulesTable rules={rec.evidence} pageSize={12} caption="Supporting rules" />
      <div className="mt-4">
        <DownloadButton onClick={() => download("supporting_rules.csv", rulesCsv(rec.evidence, setLabel), "text/csv")} disabled={rec.evidence.length === 0}>
          Download supporting rules
        </DownloadButton>
      </div>
    </Section>
  );
}
