import { itemsKey } from "./transactions";
import type { FilterStages, Itemset, RankingWeights, Rule } from "./types";

/**
 * Generate every rule A => B from frequent itemsets of length >= 2, where A
 * and B are non-empty, disjoint and A ∪ B is the itemset.
 *
 *   support    = count(A ∪ B) / N
 *   confidence = support(A ∪ B) / support(A)
 *   lift       = confidence / support(B)
 *   leverage   = support(A ∪ B) − support(A)·support(B)
 *   conviction = (1 − support(B)) / (1 − confidence)   (null when confidence = 1)
 */
export function generateRules(itemsets: Itemset[], total: number): Rule[] {
  const counts = new Map<string, number>();
  for (const s of itemsets) counts.set(itemsKey(s.items), s.count);
  const rules: Rule[] = [];

  for (const set of itemsets) {
    const n = set.items.length;
    if (n < 2) continue;
    const full = (1 << n) - 1;
    for (let mask = 1; mask < full; mask++) {
      const antecedent: number[] = [];
      const consequent: number[] = [];
      for (let i = 0; i < n; i++) (mask & (1 << i) ? antecedent : consequent).push(set.items[i]);
      const aCount = counts.get(itemsKey(antecedent));
      const cCount = counts.get(itemsKey(consequent));
      if (aCount === undefined || cCount === undefined) continue; // cannot happen (downward closure)
      const support = set.count / total;
      const sA = aCount / total;
      const sC = cCount / total;
      const confidence = support / sA;
      rules.push({
        antecedent,
        consequent,
        count: set.count,
        antecedentCount: aCount,
        consequentCount: cCount,
        support,
        antecedentSupport: sA,
        consequentSupport: sC,
        confidence,
        lift: confidence / sC,
        leverage: support - sA * sC,
        conviction: confidence >= 1 ? null : (1 - sC) / (1 - confidence),
        score: 0,
        rank: 0,
      });
    }
  }
  return rules;
}

/** Support → confidence → lift thresholds, with per-stage counts. */
export function filterRules(
  rules: Rule[],
  minSupport: number,
  minConfidence: number,
  minLift: number,
): { rules: Rule[]; stages: FilterStages } {
  const s1 = rules.filter((r) => r.support >= minSupport);
  const s2 = s1.filter((r) => r.confidence >= minConfidence);
  const s3 = s2.filter((r) => r.lift >= minLift);
  return {
    rules: s3,
    stages: { generated: rules.length, afterSupport: s1.length, afterConfidence: s2.length, afterLift: s3.length },
  };
}

export function normaliseWeights(w: RankingWeights): [number, number, number] {
  const total = w.lift + w.confidence + w.support;
  if (total <= 0) throw new Error("At least one ranking weight must be positive.");
  return [w.lift / total, w.confidence / total, w.support / total];
}

function minMax(values: number[]): (v: number) => number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || hi - lo < 1e-12) return () => 1;
  return (v) => (v - lo) / (hi - lo);
}

export interface ScoreParts {
  lift: number;
  confidence: number;
  support: number;
}

/**
 * Composite score (each component min-max scaled over the surviving rules):
 *   score = w_lift·scale(log2 lift) + w_conf·scale(confidence) + w_sup·scale(log10 support)
 * Logs damp the strong right skew of lift and support.
 */
export function scoreScalers(rules: Rule[]): { lift: (r: Rule) => number; confidence: (r: Rule) => number; support: (r: Rule) => number } {
  const l = minMax(rules.map((r) => Math.log2(Math.max(r.lift, 1e-9))));
  const c = minMax(rules.map((r) => r.confidence));
  const s = minMax(rules.map((r) => Math.log10(Math.max(r.support, 1e-12))));
  return {
    lift: (r) => l(Math.log2(Math.max(r.lift, 1e-9))),
    confidence: (r) => c(r.confidence),
    support: (r) => s(Math.log10(Math.max(r.support, 1e-12))),
  };
}

export function rankRules(rules: Rule[], weights: RankingWeights): Rule[] {
  if (rules.length === 0) return [];
  const [wl, wc, ws] = normaliseWeights(weights);
  const scale = scoreScalers(rules);
  const ranked = rules.map((r) => ({
    ...r,
    score: wl * scale.lift(r) + wc * scale.confidence(r) + ws * scale.support(r),
  }));
  ranked.sort((a, b) => b.score - a.score || b.lift - a.lift || b.support - a.support);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return ranked;
}

export function liftInterpretation(lift: number, tolerance = 0.05): string {
  if (lift > 1 + tolerance) return "positive association — requested together more often than chance";
  if (lift < 1 - tolerance) return "negative association — requested together less often than chance";
  return "approximately independent";
}

/** Collapse A→B and B→A into one combination, keeping the best-scoring direction. */
export function strongestCombinations(ranked: Rule[], limit = 20): (Rule & { combination: number[] })[] {
  const seen = new Set<string>();
  const out: (Rule & { combination: number[] })[] = [];
  for (const r of ranked) {
    const combination = [...r.antecedent, ...r.consequent].sort((a, b) => a - b);
    const key = itemsKey(combination);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, combination });
    if (out.length >= limit) break;
  }
  return out;
}

export function ruleKey(r: { antecedent: number[]; consequent: number[] }): string {
  return `${itemsKey(r.antecedent)}>${itemsKey(r.consequent)}`;
}
