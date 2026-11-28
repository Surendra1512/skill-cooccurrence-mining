import { describe, expect, it } from "vitest";
import { apriori } from "@/lib/engine/apriori";
import { fpgrowth } from "@/lib/engine/fpgrowth";
import { filterRules, generateRules } from "@/lib/engine/rules";
import { buildTransactions } from "@/lib/engine/transactions";
import { runMining } from "@/lib/engine/engine";
import { recommend } from "@/lib/engine/recommend";
import { analyseTemporal } from "@/lib/engine/temporal";
import { loadMeta, loadRealGroups, loadReference } from "./helpers";

/**
 * The TypeScript miners must reproduce mlxtend (Python) exactly on the full
 * real dataset: same itemsets, same counts, same rule counts and metrics.
 */
const meta = loadMeta();
const groups = loadRealGroups();
const reference = loadReference();
const tx = buildTransactions(groups, { roles: [], countries: [] }, meta.skills.length);

const key = (items: number[]) => items.join(",");

describe("real dataset", () => {
  it("decodes every posting", () => {
    expect(tx.total).toBe(meta.nTransactions);
    expect(tx.total).toBe(670_261);
    expect(groups.n).toBe(meta.nGroups);
  });
});

interface Reference {
  config: { minSupport: number; minConfidence: number; minLift: number; maxLen: number };
  itemsets: [number[], number][];
  rulesGenerated: number;
  rulesSurviving: number;
  sampleRules: { antecedent: number[]; consequent: number[]; support: number; confidence: number; lift: number }[];
}

describe.each((reference as Reference[]).map((r, i) => ({ i, ref: r })))("reference config $i", ({ ref }) => {
  const { minSupport, minConfidence, minLift, maxLen } = ref.config;
  const expected = new Map<string, number>(ref.itemsets.map(([items, count]) => [key(items), count]));

  for (const [name, miner] of [["FP-Growth", fpgrowth], ["Apriori", apriori]] as const) {
    it(`${name} matches mlxtend itemsets exactly`, () => {
      const result = miner(tx, minSupport, maxLen);
      expect(result.length).toBe(expected.size);
      for (const s of result) expect(expected.get(key(s.items))).toBe(s.count);
    });
  }

  it("rule generation and filtering match mlxtend", () => {
    const itemsets = fpgrowth(tx, minSupport, maxLen);
    const rules = generateRules(itemsets, tx.total);
    expect(rules.length).toBe(ref.rulesGenerated);
    const surviving = filterRules(rules, minSupport, minConfidence, minLift).rules;
    expect(surviving.length).toBe(ref.rulesSurviving);
    const byKey = new Map(surviving.map((r) => [`${key(r.antecedent)}>${key(r.consequent)}`, r]));
    for (const s of ref.sampleRules) {
      const r = byKey.get(`${key(s.antecedent)}>${key(s.consequent)}`)!;
      expect(r).toBeDefined();
      expect(r.support).toBeCloseTo(s.support, 12);
      expect(r.confidence).toBeCloseTo(s.confidence, 12);
      expect(r.lift).toBeCloseTo(s.lift, 10);
    }
  });
});


describe("real dataset matches the Python pipeline results", () => {
  const config = { algorithm: "FP-Growth" as const, minSupport: 0.01, minConfidence: 0.3, minLift: 1.2, maxLen: 3 };
  const weights = { lift: 0.4, confidence: 0.4, support: 0.2 };
  const ranked = runMining(tx, config, weights).ranked;
  const label = (r: { antecedent: number[]; consequent: number[] }) => `${r.antecedent.join("+")}>${r.consequent.join("+")}`;

  it("top-ranked rule is NumPy + Python → Pandas (score 0.777)", () => {
    const names = (ids: number[]) => ids.map((i) => meta.skills[i].label).sort().join(" + ");
    expect(`${names(ranked[0].antecedent)} → ${names(ranked[0].consequent)}`).toBe("NumPy + Python → Pandas");
    expect(ranked[0].score).toBeCloseTo(0.777, 3);
  });

  it("temporal analysis: 2023 Q1–Q4, 33 tracked rules, 11 emerging / 4 declining", () => {
    const r = analyseTemporal(groups, { roles: [], countries: [] }, meta.skills.length, meta.quarters, config,
      { minTransactionsPerPeriod: 5000, topK: 25, minRelativeChange: 0.15 }, weights, label);
    expect(r.periods).toEqual(["2023Q1", "2023Q2", "2023Q3", "2023Q4"]);
    expect(Object.keys(r.excluded)).toEqual(["2022Q4"]);
    expect(r.trends.length).toBe(33);
    expect(r.trends.filter((t) => t.trend === "emerging").length).toBe(11);
    expect(r.trends.filter((t) => t.trend === "declining").length).toBe(4);
  });

  it("Spark learner programme: Spark + Python + Hadoop + SQL in 29,259 postings", () => {
    const id = (key: string) => meta.skills.findIndex((s: { key: string }) => s.key === key);
    const r = recommend([id("spark")], ranked, groups, { roles: [], countries: [] }, meta.skills, meta.prerequisites);
    expect(r.programme!.skills).toEqual([id("spark"), id("python"), id("hadoop"), id("sql")]);
    expect(r.programme!.postings).toBe(29259);
  });
});
