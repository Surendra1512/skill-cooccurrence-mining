import { UNDATED } from "./decode";
import { runMining } from "./engine";
import { ruleKey } from "./rules";
import { buildTransactions, quarterSizes } from "./transactions";
import type {
  GroupTable,
  MiningConfig,
  PeriodMetric,
  RankingWeights,
  Rule,
  Scope,
  TemporalConfig,
  TemporalResult,
  Transactions,
  TrendRow,
} from "./types";
import { MiningError } from "./engine";

/** Metrics of fixed rules recomputed on another set of transactions. */
export function evaluateRules(tx: Transactions, rules: { antecedent: number[]; consequent: number[] }[]) {
  const mark = new Uint8Array(tx.nItems);
  const a = new Float64Array(rules.length);
  const c = new Float64Array(rules.length);
  const ac = new Float64Array(rules.length);
  const has = (items: number[]) => items.every((s) => mark[s] === 1);
  for (let t = 0; t < tx.weights.length; t++) {
    for (let i = tx.offsets[t]; i < tx.offsets[t + 1]; i++) mark[tx.items[i]] = 1;
    const w = tx.weights[t];
    for (let r = 0; r < rules.length; r++) {
      const hasA = has(rules[r].antecedent);
      const hasC = has(rules[r].consequent);
      if (hasA) a[r] += w;
      if (hasC) c[r] += w;
      if (hasA && hasC) ac[r] += w;
    }
    for (let i = tx.offsets[t]; i < tx.offsets[t + 1]; i++) mark[tx.items[i]] = 0;
  }
  return rules.map((_, r) => {
    const support = tx.total ? ac[r] / tx.total : 0;
    const confidence = a[r] ? ac[r] / a[r] : 0;
    const pc = tx.total ? c[r] / tx.total : 0;
    return { support, confidence, lift: pc ? confidence / pc : 0, count: ac[r] };
  });
}

function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - mx) * (v - my);
    den += (i - mx) ** 2;
  });
  return num / den;
}

/** Emerging / declining when support changes ≥ threshold first→last with a consistent slope. */
export function classifyTrend(supports: number[], minRelativeChange: number): { trend: TrendRow["trend"]; change: number } {
  const first = supports[0];
  const last = supports[supports.length - 1];
  if (first <= 0) return last > 0 ? { trend: "emerging", change: Infinity } : { trend: "stable", change: 0 };
  const change = (last - first) / first;
  const s = slope(supports);
  if (change >= minRelativeChange && s > 0) return { trend: "emerging", change };
  if (change <= -minRelativeChange && s < 0) return { trend: "declining", change };
  return { trend: "stable", change };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const k of a) if (b.has(k)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Re-mine each eligible quarter with identical thresholds, keep each period's
 * top-K rules, then re-evaluate the union of those rules in every period.
 */
export function analyseTemporal(
  groups: GroupTable,
  scope: Scope,
  nItems: number,
  quarters: string[],
  config: MiningConfig,
  temporal: TemporalConfig,
  weights: RankingWeights,
  label: (r: { antecedent: number[]; consequent: number[] }) => string,
): TemporalResult {
  const sizes = quarterSizes(groups, scope);
  const undated = sizes.get(UNDATED) ?? 0;
  const eligible: number[] = [];
  const excluded: Record<string, number> = {};
  const periodSizes: Record<string, number> = {};
  quarters.forEach((q, i) => {
    const n = sizes.get(i) ?? 0;
    periodSizes[q] = n;
    if (n >= temporal.minTransactionsPerPeriod) eligible.push(i);
    else if (n > 0) excluded[q] = n;
  });
  if (eligible.length < 2) {
    throw new MiningError(
      `Temporal analysis needs at least two periods with ≥ ${temporal.minTransactionsPerPeriod.toLocaleString()} postings; ` +
        `found ${eligible.length}. Lower the minimum or widen the selection.`,
    );
  }

  const txByPeriod = new Map<number, Transactions>();
  const topByPeriod: Record<string, string[]> = {};
  const tracked = new Map<string, Rule>();
  const topKeySets: Set<string>[] = [];
  for (const q of eligible) {
    const tx = buildTransactions(groups, scope, nItems, { quarter: q });
    txByPeriod.set(q, tx);
    const top = runMining(tx, config, weights).ranked.slice(0, temporal.topK);
    topByPeriod[quarters[q]] = top.map(label);
    topKeySets.push(new Set(top.map(ruleKey)));
    for (const r of top) if (!tracked.has(ruleKey(r))) tracked.set(ruleKey(r), r);
  }
  const rules = [...tracked.values()];
  if (rules.length === 0) throw new MiningError("No rule survived the thresholds in any period; relax the thresholds.");

  const metrics: PeriodMetric[] = [];
  const perRule: { support: number; lift: number }[][] = rules.map(() => []);
  for (const q of eligible) {
    const values = evaluateRules(txByPeriod.get(q)!, rules);
    values.forEach((v, r) => {
      perRule[r].push(v);
      metrics.push({ rule: label(rules[r]), period: quarters[q], ...v });
    });
  }

  const trends: TrendRow[] = rules.map((rule, r) => {
    const series = perRule[r];
    const { trend, change } = classifyTrend(series.map((v) => v.support), temporal.minRelativeChange);
    const key = ruleKey(rule);
    return {
      rule: label(rule),
      trend,
      supportFirst: series[0].support,
      supportLast: series[series.length - 1].support,
      supportChange: change,
      liftFirst: series[0].lift,
      liftLast: series[series.length - 1].lift,
      periodsInTopK: topKeySets.filter((s) => s.has(key)).length,
    };
  });
  trends.sort((a, b) => b.supportChange - a.supportChange);

  const stability = eligible.slice(1).map((q, i) => ({
    a: quarters[eligible[i]],
    b: quarters[q],
    jaccard: jaccard(topKeySets[i], topKeySets[i + 1]),
  }));

  return { periods: eligible.map((q) => quarters[q]), periodSizes, excluded, undated, metrics, trends, topByPeriod, stability };
}
