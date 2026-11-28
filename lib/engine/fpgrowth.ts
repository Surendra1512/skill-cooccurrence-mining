import type { Itemset, Transactions } from "./types";

/**
 * FP-Growth (Han, Pei & Yin, 2000) on weighted transactions.
 *
 * Transactions are inserted into a prefix tree with items ordered by
 * descending support, so postings sharing frequent prefixes share a path.
 * The tree is mined recursively through conditional pattern bases without
 * candidate generation. Output is identical to Apriori for the same threshold.
 */
interface FPNode {
  item: number;
  count: number;
  parent: FPNode | null;
  children: Map<number, FPNode>;
  next: FPNode | null;
}

interface Header {
  item: number;
  count: number;
  head: FPNode | null;
  tail: FPNode | null;
}

function newNode(item: number, parent: FPNode | null): FPNode {
  return { item, count: 0, parent, children: new Map(), next: null };
}

/** Build an FP-tree from weighted paths; returns header entries (least frequent first). */
function buildTree(paths: number[][], pathWeights: number[], minCount: number, total: number, minSupport: number): Header[] {
  const support = new Map<number, number>();
  for (let p = 0; p < paths.length; p++) {
    const w = pathWeights[p];
    for (const item of paths[p]) support.set(item, (support.get(item) ?? 0) + w);
  }
  const frequent = [...support.entries()].filter(([, c]) => c / total >= minSupport && c >= minCount);
  if (frequent.length === 0) return [];
  // Order: descending support, ties by ascending id (deterministic).
  frequent.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const rank = new Map<number, number>();
  const headers: Header[] = frequent.map(([item, count], i) => {
    rank.set(item, i);
    return { item, count, head: null, tail: null };
  });

  const root = newNode(-1, null);
  for (let p = 0; p < paths.length; p++) {
    const ordered = paths[p].filter((it) => rank.has(it)).sort((a, b) => rank.get(a)! - rank.get(b)!);
    if (ordered.length === 0) continue;
    const w = pathWeights[p];
    let node = root;
    for (const item of ordered) {
      let child = node.children.get(item);
      if (!child) {
        child = newNode(item, node);
        node.children.set(item, child);
        const header = headers[rank.get(item)!];
        if (header.tail) header.tail.next = child;
        else header.head = child;
        header.tail = child;
      }
      child.count += w;
      node = child;
    }
  }
  return headers.reverse(); // least frequent first for mining
}

function mine(headers: Header[], suffix: number[], total: number, minSupport: number, maxLen: number, out: Itemset[]): void {
  for (const header of headers) {
    const itemset = [...suffix, header.item];
    out.push({ items: [...itemset].sort((a, b) => a - b), count: header.count });
    if (itemset.length >= maxLen) continue;

    const paths: number[][] = [];
    const weights: number[] = [];
    for (let node = header.head; node; node = node.next) {
      const path: number[] = [];
      for (let p = node.parent; p && p.item !== -1; p = p.parent) path.push(p.item);
      if (path.length) {
        paths.push(path);
        weights.push(node.count);
      }
    }
    if (paths.length === 0) continue;
    const conditional = buildTree(paths, weights, 0, total, minSupport);
    if (conditional.length) mine(conditional, itemset, total, minSupport, maxLen, out);
  }
}

export function fpgrowth(tx: Transactions, minSupport: number, maxLen: number): Itemset[] {
  if (tx.total === 0) return [];
  const paths: number[][] = [];
  const weights: number[] = [];
  for (let t = 0; t < tx.weights.length; t++) {
    paths.push(Array.from(tx.items.subarray(tx.offsets[t], tx.offsets[t + 1])));
    weights.push(tx.weights[t]);
  }
  const headers = buildTree(paths, weights, 0, tx.total, minSupport);
  const out: Itemset[] = [];
  mine(headers, [], tx.total, minSupport, maxLen, out);
  return out;
}
