import type { GroupTable, Scope, Transactions } from "./types";

function mask(size: number, selected: number[]): Uint8Array | null {
  if (selected.length === 0) return null;
  const m = new Uint8Array(size);
  for (const v of selected) m[v] = 1;
  return m;
}

export interface BuildOptions {
  /** restrict to one quarter id */
  quarter?: number;
}

/**
 * Collapse posting groups in scope into weighted transactions, merging
 * identical skill sets. Mining weighted transactions is mathematically
 * identical to mining every posting individually.
 */
export function buildTransactions(groups: GroupTable, scope: Scope, nItems: number, options: BuildOptions = {}): Transactions {
  const roleMask = mask(256, scope.roles);
  const countryMask = mask(256, scope.countries);
  const index = new Map<string, number>();
  const offsets: number[] = [0];
  const items: number[] = [];
  const weights: number[] = [];
  let total = 0;

  for (let g = 0; g < groups.n; g++) {
    if (roleMask && !roleMask[groups.role[g]]) continue;
    if (countryMask && !countryMask[groups.country[g]]) continue;
    if (options.quarter !== undefined && groups.quarter[g] !== options.quarter) continue;
    const start = groups.offsets[g];
    const end = groups.offsets[g + 1];
    const w = groups.weight[g];
    total += w;
    let key = "";
    for (let i = start; i < end; i++) key += String.fromCharCode(groups.items[i]);
    const existing = index.get(key);
    if (existing !== undefined) {
      weights[existing] += w;
    } else {
      index.set(key, weights.length);
      weights.push(w);
      for (let i = start; i < end; i++) items.push(groups.items[i]);
      offsets.push(items.length);
    }
  }
  return {
    offsets: Uint32Array.from(offsets),
    items: Uint16Array.from(items),
    weights: Float64Array.from(weights),
    total,
    nItems,
  };
}

/** Number of postings in scope, per quarter id. */
export function quarterSizes(groups: GroupTable, scope: Scope): Map<number, number> {
  const roleMask = mask(256, scope.roles);
  const countryMask = mask(256, scope.countries);
  const sizes = new Map<number, number>();
  for (let g = 0; g < groups.n; g++) {
    if (roleMask && !roleMask[groups.role[g]]) continue;
    if (countryMask && !countryMask[groups.country[g]]) continue;
    const q = groups.quarter[g];
    sizes.set(q, (sizes.get(q) ?? 0) + groups.weight[g]);
  }
  return sizes;
}

/** Iterate groups in scope. */
export function forEachGroup(
  groups: GroupTable,
  scope: Scope,
  fn: (g: number) => void,
): void {
  const roleMask = mask(256, scope.roles);
  const countryMask = mask(256, scope.countries);
  for (let g = 0; g < groups.n; g++) {
    if (roleMask && !roleMask[groups.role[g]]) continue;
    if (countryMask && !countryMask[groups.country[g]]) continue;
    fn(g);
  }
}

export function itemsKey(items: ArrayLike<number>): string {
  let key = "";
  for (let i = 0; i < items.length; i++) key += String.fromCharCode(items[i]);
  return key;
}
