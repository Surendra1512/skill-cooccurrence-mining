import { forEachGroup } from "./transactions";
import type { GroupTable, Rule, Scope, SkillMeta } from "./types";

/**
 * Evidence-backed training recommendations. Every suggestion comes from a
 * mined rule whose antecedent the learner already holds. No rule → no
 * recommendation. Outputs describe employer demand, not employment outcomes.
 */

export const MODULE_NAMES: Record<string, string> = {
  programming: "Programming languages",
  libraries: "Libraries & frameworks",
  analyst_tools: "Analytics & BI tools",
  cloud: "Cloud platforms",
  databases: "Databases",
  webframeworks: "Web frameworks",
  os: "Operating systems",
  other: "DevOps & engineering tools",
  async: "Project & collaboration tools",
  sync: "Communication tools",
  uncategorised: "Other skills",
};

export interface RecommenderConfig {
  maxRecommendations: number;
  programmeSize: number;
  minProgrammePostings: number;
  topRoles: number;
}

export const DEFAULT_RECOMMENDER: RecommenderConfig = {
  maxRecommendations: 8,
  programmeSize: 3,
  minProgrammePostings: 30,
  topRoles: 5,
};

export interface Recommendation {
  skill: number;
  score: number;
  confidence: number;
  lift: number;
  support: number;
  count: number;
  antecedentCount: number;
  supportingRules: number;
  rule: Rule;
}

export interface Programme {
  skills: number[];
  added: number[];
  postings: number;
  shareOfAll: number;
  shareOfLearner: number | null;
  modules: { module: string; skills: number[] }[];
  prerequisites: { skill: number; prerequisite: string; status: "already held" | "included in programme" | "learn first" }[];
  roles: { role: number; postings: number; share: number; ratio: number }[];
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  evidence: Rule[];
  programme: Programme | null;
  messages: string[];
}

export function applicableRules(ranked: Rule[], held: Set<number>): Rule[] {
  return ranked.filter((r) => r.antecedent.every((s) => held.has(s)) && r.consequent.every((s) => !held.has(s)));
}

export function recommend(
  selected: number[],
  ranked: Rule[],
  groups: GroupTable,
  scope: Scope,
  skills: SkillMeta[],
  prerequisites: Record<string, string[]>,
  config: RecommenderConfig = DEFAULT_RECOMMENDER,
): RecommendationResult {
  const held = new Set(selected);
  if (held.size === 0) return { recommendations: [], evidence: [], programme: null, messages: ["Select at least one skill."] };
  const evidence = applicableRules(ranked, held);
  if (evidence.length === 0) {
    return {
      recommendations: [],
      evidence,
      programme: null,
      messages: [
        "No mined rule starts from the selected skills at the current thresholds, so no evidence-backed recommendation can be made. " +
          "Lower the evidence thresholds or choose fewer / more common skills.",
      ],
    };
  }

  const ruleCounts = new Map<number, number>();
  for (const r of evidence) for (const s of r.consequent) ruleCounts.set(s, (ruleCounts.get(s) ?? 0) + 1);

  // Prefer rules whose consequent is exactly the skill, so a combination's lift
  // is never attributed to a single skill; fall back to multi-skill consequents.
  const candidates = new Map<number, Recommendation>();
  for (const pass of [evidence.filter((r) => r.consequent.length === 1), evidence.filter((r) => r.consequent.length > 1)]) {
    for (const r of pass) {
      for (const s of r.consequent) {
        if (candidates.has(s)) continue;
        candidates.set(s, {
          skill: s,
          score: r.score,
          confidence: r.confidence,
          lift: r.lift,
          support: r.support,
          count: r.count,
          antecedentCount: r.antecedentCount,
          supportingRules: ruleCounts.get(s) ?? 0,
          rule: r,
        });
      }
    }
  }
  const recommendations = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, config.maxRecommendations);
  const messages: string[] = [];
  const programme = buildProgramme(selected, recommendations, groups, scope, skills, prerequisites, config, messages);
  return { recommendations, evidence, programme, messages };
}

function countContaining(groups: GroupTable, scope: Scope, required: number[]): { total: number; matching: number; roles: Map<number, number>; allRoles: Map<number, number> } {
  const need = new Set(required);
  let total = 0;
  let matching = 0;
  const roles = new Map<number, number>();
  const allRoles = new Map<number, number>();
  forEachGroup(groups, scope, (g) => {
    const w = groups.weight[g];
    total += w;
    allRoles.set(groups.role[g], (allRoles.get(groups.role[g]) ?? 0) + w);
    let found = 0;
    for (let i = groups.offsets[g]; i < groups.offsets[g + 1]; i++) if (need.has(groups.items[i])) found++;
    if (found === need.size) {
      matching += w;
      roles.set(groups.role[g], (roles.get(groups.role[g]) ?? 0) + w);
    }
  });
  return { total, matching, roles, allRoles };
}

function buildProgramme(
  held: number[],
  recs: Recommendation[],
  groups: GroupTable,
  scope: Scope,
  skills: SkillMeta[],
  prerequisites: Record<string, string[]>,
  config: RecommenderConfig,
  messages: string[],
): Programme | null {
  const combo = [...held];
  for (const rec of recs) {
    if (combo.length - held.length >= config.programmeSize) break;
    if (countContaining(groups, scope, [...combo, rec.skill]).matching >= config.minProgrammePostings) combo.push(rec.skill);
  }
  const added = combo.filter((s) => !held.includes(s));
  if (added.length === 0) {
    messages.push(`No combined programme reaches the minimum of ${config.minProgrammePostings} postings requiring the full combination.`);
    return null;
  }
  const { total, matching, roles, allRoles } = countContaining(groups, scope, combo);
  const learner = countContaining(groups, scope, held).matching;

  const modules = new Map<string, number[]>();
  for (const s of added) {
    const name = MODULE_NAMES[skills[s].category] ?? "Other skills";
    modules.set(name, [...(modules.get(name) ?? []), s]);
  }
  const keyToId = new Map(skills.map((s) => [s.key, s.id]));
  const prereqRows: Programme["prerequisites"] = [];
  for (const s of added) {
    for (const pre of prerequisites[skills[s].key] ?? []) {
      const id = keyToId.get(pre);
      prereqRows.push({
        skill: s,
        prerequisite: id !== undefined ? skills[id].label : pre,
        status: id !== undefined && held.includes(id) ? "already held" : id !== undefined && combo.includes(id) ? "included in programme" : "learn first",
      });
    }
  }
  const roleRows = [...roles.entries()]
    .map(([role, postings]) => ({
      role,
      postings,
      share: postings / matching,
      ratio: postings / matching / ((allRoles.get(role) ?? 0) / total),
    }))
    .sort((a, b) => b.postings - a.postings)
    .slice(0, config.topRoles);

  return {
    skills: combo,
    added,
    postings: matching,
    shareOfAll: total ? matching / total : 0,
    shareOfLearner: learner ? matching / learner : null,
    modules: [...modules.entries()].map(([module, s]) => ({ module, skills: s })),
    prerequisites: prereqRows,
    roles: roleRows,
  };
}

export interface GapRow {
  skill: number;
  shareInRole: number;
  shareOverall: number;
  ratio: number;
  postings: number;
}

/** Skills most requested in a role that the learner does not yet have. */
export function roleSkillGap(held: number[], role: number, groups: GroupTable, scope: Scope, nItems: number, topN = 12): GapRow[] {
  const inRole = new Float64Array(nItems);
  const overall = new Float64Array(nItems);
  let roleTotal = 0;
  let total = 0;
  forEachGroup(groups, scope, (g) => {
    const w = groups.weight[g];
    total += w;
    const isRole = groups.role[g] === role;
    if (isRole) roleTotal += w;
    for (let i = groups.offsets[g]; i < groups.offsets[g + 1]; i++) {
      overall[groups.items[i]] += w;
      if (isRole) inRole[groups.items[i]] += w;
    }
  });
  if (roleTotal === 0) return [];
  const heldSet = new Set(held);
  const rows: GapRow[] = [];
  inRole.forEach((c, s) => {
    if (c > 0 && !heldSet.has(s)) {
      const shareOverall = overall[s] / total;
      rows.push({ skill: s, shareInRole: c / roleTotal, shareOverall, ratio: c / roleTotal / shareOverall, postings: c });
    }
  });
  return rows.sort((a, b) => b.postings - a.postings).slice(0, topN);
}
