import { itemsKey } from "./transactions";
import type { Itemset, Transactions } from "./types";

/**
 * Apriori (Agrawal & Srikant, 1994) on weighted transactions.
 *
 * Level-wise: frequent (k-1)-itemsets sharing a (k-2)-prefix are joined into
 * k-candidates; candidates with an infrequent subset are pruned (support is
 * anti-monotone); survivors are counted in one pass over the transactions.
 * An itemset is frequent when count / total >= minSupport (same float test as
 * mlxtend, so results match it exactly).
 */
export function apriori(tx: Transactions, minSupport: number, maxLen: number): Itemset[] {
  const { offsets, items, weights, total, nItems } = tx;
  const nTx = weights.length;
  if (total === 0) return [];
  const isFrequent = (count: number) => count / total >= minSupport;

  // Level 1
  const single = new Float64Array(nItems);
  for (let t = 0; t < nTx; t++) {
    const w = weights[t];
    for (let i = offsets[t]; i < offsets[t + 1]; i++) single[items[i]] += w;
  }
  const result: Itemset[] = [];
  const frequentItem = new Uint8Array(nItems);
  let previous: number[][] = [];
  for (let s = 0; s < nItems; s++) {
    if (isFrequent(single[s])) {
      frequentItem[s] = 1;
      previous.push([s]);
      result.push({ items: [s], count: single[s] });
    }
  }

  // Keep only frequent items per transaction (projection used by every level).
  const projected: number[][] = [];
  const projWeights: number[] = [];
  for (let t = 0; t < nTx; t++) {
    const row: number[] = [];
    for (let i = offsets[t]; i < offsets[t + 1]; i++) if (frequentItem[items[i]]) row.push(items[i]);
    if (row.length >= 2) {
      projected.push(row);
      projWeights.push(weights[t]);
    }
  }

  const mark = new Uint8Array(nItems);
  for (let k = 2; k <= maxLen && previous.length > 1; k++) {
    const prevKeys = new Set(previous.map(itemsKey));
    const candidates = generateCandidates(previous, prevKeys);
    if (candidates.length === 0) break;
    const candIndex = new Map<string, number>();
    candidates.forEach((c, i) => candIndex.set(itemsKey(c), i));
    const counts = new Float64Array(candidates.length);

    for (let t = 0; t < projected.length; t++) {
      const row = projected[t];
      if (row.length < k) continue;
      const w = projWeights[t];
      if (binomial(row.length, k) <= candidates.length) {
        forEachCombination(row, k, (combo) => {
          const idx = candIndex.get(itemsKey(combo));
          if (idx !== undefined) counts[idx] += w;
        });
      } else {
        for (const s of row) mark[s] = 1;
        for (let c = 0; c < candidates.length; c++) {
          const cand = candidates[c];
          let all = true;
          for (let j = 0; j < k; j++) {
            if (!mark[cand[j]]) {
              all = false;
              break;
            }
          }
          if (all) counts[c] += w;
        }
        for (const s of row) mark[s] = 0;
      }
    }

    previous = [];
    for (let c = 0; c < candidates.length; c++) {
      if (isFrequent(counts[c])) {
        previous.push(candidates[c]);
        result.push({ items: candidates[c], count: counts[c] });
      }
    }
  }
  return result;
}

/** Join step + prune step. `previous` must be lexicographically sorted. */
function generateCandidates(previous: number[][], prevKeys: Set<string>): number[][] {
  const out: number[][] = [];
  const k1 = previous[0].length;
  for (let i = 0; i < previous.length; i++) {
    const a = previous[i];
    for (let j = i + 1; j < previous.length; j++) {
      const b = previous[j];
      let samePrefix = true;
      for (let p = 0; p < k1 - 1; p++) {
        if (a[p] !== b[p]) {
          samePrefix = false;
          break;
        }
      }
      if (!samePrefix) break; // sorted: once the prefix differs, no later b matches
      const cand = [...a, b[k1 - 1]];
      if (allSubsetsFrequent(cand, prevKeys)) out.push(cand);
    }
  }
  return out;
}

function allSubsetsFrequent(cand: number[], prevKeys: Set<string>): boolean {
  // Subsets dropping one of the last two items are a and b themselves.
  for (let drop = 0; drop < cand.length - 2; drop++) {
    const subset = cand.filter((_, i) => i !== drop);
    if (!prevKeys.has(itemsKey(subset))) return false;
  }
  return true;
}

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function forEachCombination(row: number[], k: number, fn: (combo: number[]) => void): void {
  const idx = Array.from({ length: k }, (_, i) => i);
  const combo = new Array<number>(k);
  const n = row.length;
  for (;;) {
    for (let i = 0; i < k; i++) combo[i] = row[idx[i]];
    fn(combo);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}
