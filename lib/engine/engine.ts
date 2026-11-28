import { apriori } from "./apriori";
import { fpgrowth } from "./fpgrowth";
import { filterRules, generateRules, rankRules, ruleKey } from "./rules";
import { itemsKey } from "./transactions";
import type { Algorithm, ComparisonResult, Itemset, MiningConfig, MiningResult, RankingWeights, Transactions } from "./types";

export const MAX_ITEMSETS = 60_000;

export class MiningError extends Error {}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function validateConfig(c: MiningConfig): void {
  if (!(c.minSupport > 0 && c.minSupport <= 1)) throw new MiningError("Minimum support must be in (0, 1].");
  if (!(c.minConfidence >= 0 && c.minConfidence <= 1)) throw new MiningError("Minimum confidence must be in [0, 1].");
  if (!(c.minLift >= 0)) throw new MiningError("Minimum lift must be non-negative.");
  if (!(c.maxLen >= 2 && c.maxLen <= 6)) throw new MiningError("Maximum itemset length must be between 2 and 6.");
}

export function mineItemsets(tx: Transactions, algorithm: Algorithm, minSupport: number, maxLen: number): { itemsets: Itemset[]; seconds: number } {
  if (tx.total === 0) throw new MiningError("No postings in the current selection.");
  const start = now();
  const itemsets = algorithm === "Apriori" ? apriori(tx, minSupport, maxLen) : fpgrowth(tx, minSupport, maxLen);
  const seconds = (now() - start) / 1000;
  if (itemsets.length > MAX_ITEMSETS) {
    throw new MiningError(
      `${itemsets.length.toLocaleString()} frequent itemsets exceed the safety limit of ${MAX_ITEMSETS.toLocaleString()}. ` +
        "Increase minimum support or reduce the maximum itemset length.",
    );
  }
  itemsets.sort((a, b) => a.items.length - b.items.length || b.count - a.count);
  return { itemsets, seconds };
}

export function runMining(tx: Transactions, config: MiningConfig, weights: RankingWeights): MiningResult {
  validateConfig(config);
  const { itemsets, seconds } = mineItemsets(tx, config.algorithm, config.minSupport, config.maxLen);
  const all = generateRules(itemsets, tx.total);
  const { rules, stages } = filterRules(all, config.minSupport, config.minConfidence, config.minLift);
  return {
    config,
    total: tx.total,
    uniqueTransactions: tx.weights.length,
    itemsets,
    rulesGenerated: all.length,
    stages,
    ranked: rankRules(rules, weights),
    allLifts: Float64Array.from(all, (r) => r.lift),
    seconds,
  };
}

/** Run both algorithms on identical input and thresholds and compare outputs. */
export function compareAlgorithms(tx: Transactions, config: MiningConfig): ComparisonResult {
  validateConfig(config);
  const runs = [];
  const supports: Map<string, number>[] = [];
  const ruleSets: Set<string>[] = [];
  for (const algorithm of ["Apriori", "FP-Growth"] as Algorithm[]) {
    const { itemsets, seconds } = mineItemsets(tx, algorithm, config.minSupport, config.maxLen);
    const all = generateRules(itemsets, tx.total);
    const { rules } = filterRules(all, config.minSupport, config.minConfidence, config.minLift);
    supports.push(new Map(itemsets.map((s) => [itemsKey(s.items), s.count / tx.total])));
    ruleSets.push(new Set(rules.map(ruleKey)));
    runs.push({ algorithm, seconds, itemsets: itemsets.length, rules: all.length, surviving: rules.length });
  }
  const [a, b] = supports;
  let shared = 0;
  let maxDiff = 0;
  for (const [k, v] of a) {
    const other = b.get(k);
    if (other !== undefined) {
      shared++;
      maxDiff = Math.max(maxDiff, Math.abs(v - other));
    }
  }
  const union = a.size + b.size - shared;
  const sameRules = ruleSets[0].size === ruleSets[1].size && [...ruleSets[0]].every((k) => ruleSets[1].has(k));
  return {
    runs,
    identicalItemsets: shared === a.size && shared === b.size,
    identicalRules: sameRules,
    jaccard: union === 0 ? 1 : shared / union,
    maxSupportDifference: maxDiff,
  };
}
