import { describe, expect, it } from "vitest";
import { apriori, binomial } from "@/lib/engine/apriori";
import { UNDATED, decodeGroups } from "@/lib/engine/decode";
import { compareAlgorithms, MiningError, runMining } from "@/lib/engine/engine";
import { baselinePairs, segmentFrequency, skillFrequency } from "@/lib/engine/frequency";
import { fpgrowth } from "@/lib/engine/fpgrowth";
import { cleanSkillText, parseSkillCell, SkillNormalizer } from "@/lib/engine/normalize";
import { recommend, roleSkillGap } from "@/lib/engine/recommend";
import { filterRules, generateRules, liftInterpretation, rankRules, strongestCombinations } from "@/lib/engine/rules";
import { analyseTemporal, classifyTrend } from "@/lib/engine/temporal";
import { buildTransactions } from "@/lib/engine/transactions";
import type { GroupTable, MiningConfig, SkillMeta } from "@/lib/engine/types";
import { buildUploadDataset } from "@/lib/engine/upload";

/**
 * Hand-verifiable fixture (N = 5), identical to the Python test suite:
 *   0 python, 1 sql, 2 excel, 3 tableau
 *   {python, sql, excel}, {python, sql}, {python, excel}, {sql, excel}, {python, sql, excel, tableau}
 */
function groupsFrom(rows: { items: number[]; role?: number; country?: number; quarter?: number; weight?: number }[]): GroupTable {
  const offsets = new Uint32Array(rows.length + 1);
  const items: number[] = [];
  rows.forEach((r, i) => {
    offsets[i] = items.length;
    items.push(...[...r.items].sort((a, b) => a - b));
  });
  offsets[rows.length] = items.length;
  return {
    n: rows.length,
    role: Uint8Array.from(rows, (r) => r.role ?? 0),
    country: Uint8Array.from(rows, (r) => r.country ?? 0),
    quarter: Uint8Array.from(rows, (r) => r.quarter ?? 0),
    weight: Uint32Array.from(rows, (r) => r.weight ?? 1),
    offsets,
    items: Uint16Array.from(items),
  };
}

const TOY = groupsFrom([
  { items: [0, 1, 2], role: 0 },
  { items: [0, 1], role: 0 },
  { items: [0, 2], role: 1 },
  { items: [1, 2], role: 0 },
  { items: [0, 1, 2, 3], role: 1 },
]);
const ALL = { roles: [], countries: [] };
const tx = buildTransactions(TOY, ALL, 4);
const SKILLS: SkillMeta[] = ["python", "sql", "excel", "tableau"].map((key, id) => ({
  id, key, label: key[0].toUpperCase() + key.slice(1), category: id < 2 ? "programming" : "analyst_tools", postings: 0, variants: key,
}));
const find = (rules: ReturnType<typeof generateRules>, a: number[], c: number[]) =>
  rules.find((r) => r.antecedent.join() === a.join() && r.consequent.join() === c.join())!;

describe("hand-verified metrics", () => {
  const rules = generateRules(fpgrowth(tx, 0.2, 4), tx.total);
  it.each([
    [[0], [1], 0.6, 0.75, 0.9375],
    [[0, 1], [2], 0.4, 2 / 3, (2 / 3) / 0.8],
    [[3], [0], 0.2, 1.0, 1.25],
    [[0], [1, 2], 0.4, 0.5, 0.5 / 0.6],
  ])("%j → %j", (a, c, support, confidence, lift) => {
    const r = find(rules, a as number[], c as number[]);
    expect(r.support).toBeCloseTo(support as number, 12);
    expect(r.confidence).toBeCloseTo(confidence as number, 12);
    expect(r.lift).toBeCloseTo(lift as number, 12);
  });
  it("satisfies metric identities", () => {
    for (const r of rules) {
      expect(r.confidence).toBeCloseTo(r.support / r.antecedentSupport, 12);
      expect(r.lift).toBeCloseTo(r.confidence / r.consequentSupport, 12);
    }
  });
  it("produces single and multi-skill antecedents and consequents", () => {
    expect(rules.some((r) => r.antecedent.length > 1)).toBe(true);
    expect(rules.some((r) => r.consequent.length > 1)).toBe(true);
  });
});

describe("miners", () => {
  it.each([0.2, 0.4, 0.6])("Apriori equals FP-Growth at support %f", (s) => {
    const key = (x: { items: number[]; count: number }) => `${x.items.join()}:${x.count}`;
    expect(apriori(tx, s, 4).map(key).sort()).toEqual(fpgrowth(tx, s, 4).map(key).sort());
  });
  it("respects max length", () => {
    expect(Math.max(...fpgrowth(tx, 0.2, 2).map((s) => s.items.length))).toBe(2);
  });
  it("handles weights exactly like repeated postings", () => {
    const weighted = buildTransactions(groupsFrom([{ items: [0, 1], weight: 3 }, { items: [0], weight: 1 }]), ALL, 2);
    const repeated = buildTransactions(groupsFrom([{ items: [0, 1] }, { items: [0, 1] }, { items: [0, 1] }, { items: [0] }]), ALL, 2);
    expect(fpgrowth(weighted, 0.5, 2)).toEqual(fpgrowth(repeated, 0.5, 2));
    expect(repeated.weights.length).toBe(2); // identical skill sets merged
  });
  it("agree on random data", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = Array.from({ length: 400 }, () => ({ items: [...new Set(Array.from({ length: 1 + Math.floor(rand() * 5) }, () => Math.floor(rand() * 9)))] }));
    const t = buildTransactions(groupsFrom(rows), ALL, 9);
    const key = (x: { items: number[]; count: number }) => `${x.items.join()}:${x.count}`;
    expect(apriori(t, 0.03, 4).map(key).sort()).toEqual(fpgrowth(t, 0.03, 4).map(key).sort());
  });
  it("binomial", () => {
    expect(binomial(5, 2)).toBe(10);
    expect(binomial(52, 3)).toBe(22100);
  });
});

describe("filtering and ranking", () => {
  const rules = generateRules(fpgrowth(tx, 0.2, 4), tx.total);
  it("filters sequentially with stage counts", () => {
    const { rules: kept, stages } = filterRules(rules, 0.4, 0.6, 0.9);
    expect(kept.every((r) => r.support >= 0.4 && r.confidence >= 0.6 && r.lift >= 0.9)).toBe(true);
    expect(stages.generated).toBeGreaterThanOrEqual(stages.afterSupport);
    expect(stages.afterConfidence).toBeGreaterThanOrEqual(stages.afterLift);
  });
  it("lift ≥ 1 keeps only positive associations (tableau rules here)", () => {
    const kept = filterRules(rules, 0, 0, 1.0).rules;
    expect(kept.every((r) => [...r.antecedent, ...r.consequent].includes(3))).toBe(true);
  });
  it("applies the documented score formula", () => {
    const base = { antecedent: [0], consequent: [1], count: 1, antecedentCount: 1, consequentCount: 1, antecedentSupport: 0, consequentSupport: 0, leverage: 0, conviction: null, score: 0, rank: 0 };
    const rs = [
      { ...base, support: 0.01, confidence: 0.5, lift: 2 },
      { ...base, antecedent: [2], support: 0.1, confidence: 0.9, lift: 4 },
      { ...base, antecedent: [3], support: 0.001, confidence: 0.3, lift: 8 },
    ];
    const liftOnly = rankRules(rs, { lift: 1, confidence: 0, support: 0 });
    expect(liftOnly.map((r) => r.lift)).toEqual([8, 4, 2]);
    expect(liftOnly.map((r) => r.score)).toEqual([1, 0.5, 0]);
    const balanced = rankRules(rs, { lift: 0.4, confidence: 0.4, support: 0.2 });
    expect(balanced.find((r) => r.antecedent[0] === 2)!.score).toBeCloseTo(0.4 * 0.5 + 0.4 * 1 + 0.2 * 1, 12);
    expect(() => rankRules(rs, { lift: 0, confidence: 0, support: 0 })).toThrow();
  });
  it("collapses rule directions into combinations", () => {
    const combos = strongestCombinations(rankRules(rules, { lift: 0.4, confidence: 0.4, support: 0.2 }), 100);
    expect(new Set(combos.map((c) => c.combination.join())).size).toBe(combos.length);
  });
  it("interprets lift", () => {
    expect(liftInterpretation(1.5)).toMatch(/^positive/);
    expect(liftInterpretation(1.0)).toMatch(/^approximately/);
    expect(liftInterpretation(0.5)).toMatch(/^negative/);
  });
});

describe("engine", () => {
  const config: MiningConfig = { algorithm: "Apriori", minSupport: 0.2, minConfidence: 0.5, minLift: 1.0, maxLen: 3 };
  it("runs end to end", () => {
    const result = runMining(tx, config, { lift: 0.4, confidence: 0.4, support: 0.2 });
    expect(result.ranked.length).toBe(result.stages.afterLift);
    for (let i = 1; i < result.ranked.length; i++) expect(result.ranked[i - 1].score).toBeGreaterThanOrEqual(result.ranked[i].score);
  });
  it("compares algorithms on identical input", () => {
    const c = compareAlgorithms(tx, config);
    expect(c.identicalItemsets && c.identicalRules).toBe(true);
    expect(c.jaccard).toBe(1);
  });
  it("rejects invalid configs and empty selections", () => {
    expect(() => runMining(tx, { ...config, maxLen: 1 }, { lift: 1, confidence: 1, support: 1 })).toThrow(MiningError);
    const empty = buildTransactions(TOY, { roles: [9], countries: [] }, 4);
    expect(() => runMining(empty, config, { lift: 1, confidence: 1, support: 1 })).toThrow(MiningError);
  });
});

describe("baseline", () => {
  const freq = skillFrequency(tx);
  it("counts frequency with deterministic ties", () => {
    expect(freq.map((r) => r.id)).toEqual([0, 1, 2, 3]);
    expect(freq.map((r) => r.share)).toEqual([0.8, 0.8, 0.8, 0.2]);
  });
  it("compares observed and expected joint support", () => {
    const p = baselinePairs(tx, freq, 3).find((x) => x.a === 0 && x.b === 2)!;
    expect(p.observedSupport).toBeCloseTo(0.6, 12);
    expect(p.expectedSupport).toBeCloseTo(0.64, 12);
    expect(p.lift).toBeCloseTo(0.9375, 12);
  });
  it("segments by role", () => {
    const cell = segmentFrequency(TOY, ALL, "role", [3], [1])[0];
    expect(cell.postings).toBe(1);
    expect(cell.segmentSize).toBe(2);
    expect(cell.share).toBe(0.5);
  });
});

describe("temporal", () => {
  it.each([
    [[0.1, 0.12, 0.15], "emerging"],
    [[0.15, 0.12, 0.1], "declining"],
    [[0.1, 0.101, 0.102], "stable"],
    [[0, 0.05], "emerging"],
  ])("classifies %j", (series, label) => {
    expect(classifyTrend(series as number[], 0.15).trend).toBe(label);
  });

  // python(0)+pandas(1) rises Q1→Q2, sql(2)+excel(3) falls; java(4) filler.
  const rows = [
    ...Array.from({ length: 10 }, () => ({ items: [0, 1], quarter: 0 })),
    ...Array.from({ length: 40 }, () => ({ items: [2, 3], quarter: 0 })),
    ...Array.from({ length: 50 }, () => ({ items: [4], quarter: 0 })),
    ...Array.from({ length: 40 }, () => ({ items: [0, 1], quarter: 1 })),
    ...Array.from({ length: 10 }, () => ({ items: [2, 3], quarter: 1 })),
    ...Array.from({ length: 50 }, () => ({ items: [4], quarter: 1 })),
    { items: [0], quarter: 2 },
    { items: [0], quarter: UNDATED },
  ];
  const groups = groupsFrom(rows);
  const names = ["python", "pandas", "sql", "excel", "java"];
  const label = (r: { antecedent: number[]; consequent: number[] }) => `${r.antecedent.map((i) => names[i]).join(" + ")} → ${r.consequent.map((i) => names[i]).join(" + ")}`;
  const cfg: MiningConfig = { algorithm: "FP-Growth", minSupport: 0.05, minConfidence: 0.5, minLift: 1.0, maxLen: 2 };

  it("detects emerging and declining combinations and reports exclusions", () => {
    const r = analyseTemporal(groups, ALL, 5, ["2023Q1", "2023Q2", "2023Q3"], cfg, { minTransactionsPerPeriod: 50, topK: 10, minRelativeChange: 0.15 }, { lift: 0.4, confidence: 0.4, support: 0.2 }, label);
    expect(r.periods).toEqual(["2023Q1", "2023Q2"]);
    expect(r.excluded).toEqual({ "2023Q3": 1 });
    expect(r.undated).toBe(1);
    const trend = Object.fromEntries(r.trends.map((t) => [t.rule, t.trend]));
    expect(trend["python → pandas"]).toBe("emerging");
    expect(trend["sql → excel"]).toBe("declining");
    const q2 = r.metrics.find((m) => m.rule === "python → pandas" && m.period === "2023Q2")!;
    expect(q2.support).toBeCloseTo(0.4, 12);
  });
  it("needs two eligible periods", () => {
    expect(() => analyseTemporal(groups, ALL, 5, ["2023Q1", "2023Q2", "2023Q3"], cfg, { minTransactionsPerPeriod: 10_000, topK: 10, minRelativeChange: 0.15 }, { lift: 1, confidence: 1, support: 1 }, label)).toThrow(MiningError);
  });
});

describe("recommender", () => {
  const ranked = runMining(tx, { algorithm: "FP-Growth", minSupport: 0.2, minConfidence: 0, minLift: 0, maxLen: 4 }, { lift: 0.4, confidence: 0.4, support: 0.2 }).ranked;
  const cfg = { maxRecommendations: 5, programmeSize: 2, minProgrammePostings: 1, topRoles: 3 };

  it("backs every recommendation with a rule and prefers single-skill consequents", () => {
    const r = recommend([3], ranked, TOY, ALL, SKILLS, {}, cfg);
    expect(new Set(r.recommendations.map((x) => x.skill))).toEqual(new Set([0, 1, 2]));
    for (const rec of r.recommendations) {
      expect(rec.rule.consequent).toEqual([rec.skill]);
      expect(rec.confidence).toBeCloseTo(1, 12);
      expect(rec.lift).toBeCloseTo(1.25, 12);
    }
  });
  it("builds a programme with counts and roles", () => {
    const p = recommend([3], ranked, TOY, ALL, SKILLS, { excel: ["tableau"] }, cfg).programme!;
    expect(p.skills.length).toBe(3);
    expect(p.postings).toBe(1);
    expect(p.shareOfLearner).toBe(1);
    expect(p.roles[0].role).toBe(1);
  });
  it("refuses to recommend without evidence", () => {
    const r = recommend([0], [], TOY, ALL, SKILLS, {}, cfg);
    expect(r.recommendations).toEqual([]);
    expect(r.messages[0]).toMatch(/No mined rule/);
  });
  it("respects the minimum programme postings", () => {
    const r = recommend([3], ranked, TOY, ALL, SKILLS, {}, { ...cfg, minProgrammePostings: 10 });
    expect(r.programme).toBeNull();
  });
  it("computes role skill gaps", () => {
    const gap = roleSkillGap([0], 1, TOY, ALL, 4);
    const tableau = gap.find((g) => g.skill === 3)!;
    expect(gap.some((g) => g.skill === 0)).toBe(false);
    expect(tableau.shareInRole).toBe(0.5);
    expect(tableau.shareOverall).toBeCloseTo(0.2, 12);
    expect(tableau.ratio).toBeCloseTo(2.5, 12);
  });
});

describe("normalisation", () => {
  it.each([["  Python  ", "python"], ["C++", "c++"], ["C#", "c#"], ["Node.JS", "node.js"], ["Power   BI", "power bi"], ["SQL!!", "sql"], ["-excel-", "excel"]])(
    "cleans %s", (raw, expected) => expect(cleanSkillText(raw)).toBe(expected),
  );
  const n = new SkillNormalizer({ powerbi: "power bi", golang: "go", "react.js": "react" });
  it("maps synonyms and suffixes but keeps distinctions", () => {
    expect(n.normalize("PowerBI")).toBe("power bi");
    expect(n.normalize("golang")).toBe("go");
    expect(n.normalize("Python Programming")).toBe("python");
    expect(n.normalize("angular")).not.toBe(n.normalize("angular.js"));
  });
  it("removes invalid tokens", () => {
    for (const bad of ["", "1234", "n/a", "None", "!!!", "x".repeat(70)]) expect(n.normalize(bad)).toBeNull();
  });
  it("dedupes and sorts", () => {
    expect(n.normalizeList(["Python", "SQL", "Excel", "Power BI", "Python Programming"])).toEqual(["excel", "power bi", "python", "sql"]);
  });
  it.each([
    ["['python', 'sql']", ["python", "sql"]],
    ["python; sql; excel", ["python", "sql", "excel"]],
    ["python|sql", ["python", "sql"]],
    ["python, sql", ["python", "sql"]],
    ["python", ["python"]],
    ["", []],
  ])("parses %s", (cell, expected) => expect(parseSkillCell(cell)).toEqual(expected));
});

describe("upload", () => {
  const rows = [
    { id: "1", skills: "['python','sql']", role: "Analyst", date: "2023-02-01", company: "A", title: "t", location: "x" },
    { id: "1", skills: "['python']", role: "Analyst", date: "2023-02-01", company: "A", title: "t", location: "x" }, // duplicate id
    { id: "2", skills: "PowerBI; SQL", role: "", date: "2023-05-01", company: "B", title: "t", location: "x" },
    { id: "3", skills: "n/a", role: "Analyst", date: "2023-05-01", company: "C", title: "t", location: "x" }, // no valid skill
    { id: "4", skills: "['python','sql']", role: "Analyst", date: "2023-02-01", company: "A", title: "t", location: "x" }, // content duplicate
    { id: "5", skills: "python, sql", role: "Analyst", date: "not a date", company: "", title: "", location: "" },
  ];
  const ds = buildUploadDataset(rows, { skills: "skills", jobId: "id", role: "role", date: "date", company: "company", title: "title", location: "location" }, "test.csv", { powerbi: "power bi" }, { sql: "SQL" }, {});
  it("applies the same cleaning rules as the Python pipeline", () => {
    expect(ds.report.original_records).toBe(6);
    expect(ds.report.duplicate_ids_removed).toBe(1);
    expect(ds.report.postings_without_skills_removed).toBe(1);
    expect(ds.report.duplicate_content_removed).toBe(1);
    expect(ds.report.cleaned_records).toBe(3);
    expect(ds.roles).toContain("Unknown");
    expect(ds.quarters).toEqual(["2023Q1", "2023Q2"]);
    expect(ds.skills.find((s) => s.key === "sql")!.label).toBe("SQL");
    expect(ds.skills.map((s) => s.key)).toContain("power bi");
  });
  it("produces minable groups", () => {
    const t = buildTransactions(ds.groups, ALL, ds.skills.length);
    expect(t.total).toBe(3);
  });
  it("rejects files without the mapped column", () => {
    expect(() => buildUploadDataset(rows, { skills: "nope" }, "x.csv", {}, {}, {})).toThrow(/Missing column/);
  });
});

describe("decoder", () => {
  it("rejects bad headers", () => {
    expect(() => decodeGroups(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow();
  });
});
