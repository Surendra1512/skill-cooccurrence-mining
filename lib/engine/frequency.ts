import { forEachGroup } from "./transactions";
import type { GroupTable, Scope, Transactions } from "./types";

export interface FrequencyRow {
  id: number;
  postings: number;
  share: number;
  rank: number;
}

/** Baseline: postings and share per skill, ranked (ties broken by id). */
export function skillFrequency(tx: Transactions): FrequencyRow[] {
  const counts = new Float64Array(tx.nItems);
  for (let t = 0; t < tx.weights.length; t++) {
    const w = tx.weights[t];
    for (let i = tx.offsets[t]; i < tx.offsets[t + 1]; i++) counts[tx.items[i]] += w;
  }
  const rows: FrequencyRow[] = [];
  counts.forEach((c, id) => {
    if (c > 0) rows.push({ id, postings: c, share: c / tx.total, rank: 0 });
  });
  rows.sort((a, b) => b.postings - a.postings || a.id - b.id);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export interface SegmentCell {
  segment: number;
  skill: number;
  postings: number;
  segmentSize: number;
  share: number;
}

/** Share of postings requiring each skill, per role or country (or quarter). */
export function segmentFrequency(
  groups: GroupTable,
  scope: Scope,
  dimension: "role" | "country" | "quarter",
  skills: number[],
  segments: number[],
): SegmentCell[] {
  const column = groups[dimension];
  const wantSkill = new Map(skills.map((s, i) => [s, i]));
  const wantSeg = new Map(segments.map((s, i) => [s, i]));
  const counts = segments.map(() => new Float64Array(skills.length));
  const sizes = new Float64Array(segments.length);
  forEachGroup(groups, scope, (g) => {
    const si = wantSeg.get(column[g]);
    if (si === undefined) return;
    const w = groups.weight[g];
    sizes[si] += w;
    for (let i = groups.offsets[g]; i < groups.offsets[g + 1]; i++) {
      const k = wantSkill.get(groups.items[i]);
      if (k !== undefined) counts[si][k] += w;
    }
  });
  const out: SegmentCell[] = [];
  segments.forEach((segment, si) =>
    skills.forEach((skill, k) =>
      out.push({ segment, skill, postings: counts[si][k], segmentSize: sizes[si], share: sizes[si] ? counts[si][k] / sizes[si] : 0 }),
    ),
  );
  return out;
}

/** Segment sizes (postings) in scope for a dimension, largest first. */
export function segmentSizes(groups: GroupTable, scope: Scope, dimension: "role" | "country" | "quarter"): [number, number][] {
  const sizes = new Map<number, number>();
  const column = groups[dimension];
  forEachGroup(groups, scope, (g) => sizes.set(column[g], (sizes.get(column[g]) ?? 0) + groups.weight[g]));
  return [...sizes.entries()].sort((a, b) => b[1] - a[1]);
}

/** Pairwise joint posting counts for the given skills. */
export function pairCounts(tx: Transactions, skills: number[]): number[][] {
  const pos = new Map(skills.map((s, i) => [s, i]));
  const m = skills.map(() => new Array<number>(skills.length).fill(0));
  const present: number[] = [];
  for (let t = 0; t < tx.weights.length; t++) {
    present.length = 0;
    for (let i = tx.offsets[t]; i < tx.offsets[t + 1]; i++) {
      const p = pos.get(tx.items[i]);
      if (p !== undefined) present.push(p);
    }
    const w = tx.weights[t];
    for (let a = 0; a < present.length; a++) for (let b = 0; b < present.length; b++) m[present[a]][present[b]] += w;
  }
  return m;
}

export interface BaselinePair {
  a: number;
  b: number;
  baselineScore: number;
  expectedSupport: number;
  observedSupport: number;
  lift: number;
  together: number;
}

/**
 * Pairs a frequency-only planner would bundle (top-N skills), with the joint
 * support observed vs. expected under independence. Lift ≈ 1 ⇒ frequent but
 * not associated.
 */
export function baselinePairs(tx: Transactions, freq: FrequencyRow[], topN: number): BaselinePair[] {
  const top = freq.slice(0, topN);
  const m = pairCounts(tx, top.map((r) => r.id));
  const out: BaselinePair[] = [];
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      const observed = m[i][j] / tx.total;
      const expected = top[i].share * top[j].share;
      out.push({
        a: top[i].id,
        b: top[j].id,
        baselineScore: top[i].share + top[j].share,
        expectedSupport: expected,
        observedSupport: observed,
        lift: expected ? observed / expected : 0,
        together: m[i][j],
      });
    }
  return out.sort((x, y) => y.baselineScore - x.baselineScore);
}

/** Distribution of transaction sizes (skills per posting). */
export function sizeDistribution(tx: Transactions): { size: number; postings: number }[] {
  const counts = new Map<number, number>();
  for (let t = 0; t < tx.weights.length; t++) {
    const size = tx.offsets[t + 1] - tx.offsets[t];
    counts.set(size, (counts.get(size) ?? 0) + tx.weights[t]);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([size, postings]) => ({ size, postings }));
}
