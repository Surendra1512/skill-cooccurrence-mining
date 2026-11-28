/**
 * Shared types for the mining engine. The engine is pure TypeScript with no
 * DOM dependencies so it runs in a Web Worker, in the browser and in Node tests.
 */

export type Algorithm = "FP-Growth" | "Apriori";

export interface SkillMeta {
  id: number;
  key: string;
  label: string;
  category: string;
  postings: number;
  variants: string;
}

/** Posting groups: postings sharing skill set, role, country and quarter. */
export interface GroupTable {
  n: number;
  role: Uint8Array;
  country: Uint8Array;
  quarter: Uint8Array; // UNDATED (255) when the posting has no valid date
  weight: Uint32Array;
  offsets: Uint32Array; // length n + 1, into items
  items: Uint16Array; // sorted skill ids per group
}

export interface PreprocessingReport {
  source: string;
  original_records: number;
  cleaned_records: number;
  duplicate_records_removed: number;
  duplicate_ids_removed: number;
  duplicate_content_removed: number;
  missing_job_id_removed: number;
  postings_without_skills_removed: number;
  missing_values_by_column: Record<string, number>;
  unparseable_dates: number;
  distinct_raw_skill_strings: number;
  synonym_variants_merged: number;
  invalid_skill_strings_removed: number;
  unique_skills: number;
  total_transactions: number;
  total_skill_mentions: number;
  avg_skills_per_transaction: number;
  median_skills_per_transaction: number;
  single_skill_transactions: number;
  date_min: string | null;
  date_max: string | null;
}

export type TraceRow = [raw: string, cleaned: string, canonical: string | null, status: string, occurrences: number];

export interface Dataset {
  id: string;
  label: string;
  kind: "reference" | "upload";
  skills: SkillMeta[];
  roles: string[];
  countries: string[];
  quarters: string[];
  groups: GroupTable;
  report: PreprocessingReport;
  trace: TraceRow[];
  prerequisites: Record<string, string[]>;
}

/** Empty arrays mean "all". */
export interface Scope {
  roles: number[];
  countries: number[];
}

/** Weighted transactions with identical skill sets merged. */
export interface Transactions {
  offsets: Uint32Array;
  items: Uint16Array;
  weights: Float64Array;
  total: number; // sum of weights = number of postings
  nItems: number; // vocabulary size
}

export interface MiningConfig {
  algorithm: Algorithm;
  minSupport: number;
  minConfidence: number;
  minLift: number;
  maxLen: number;
}

export interface RankingWeights {
  lift: number;
  confidence: number;
  support: number;
}

export interface Itemset {
  items: number[]; // ascending skill ids
  count: number;
}

export interface Rule {
  antecedent: number[];
  consequent: number[];
  count: number;
  antecedentCount: number;
  consequentCount: number;
  support: number;
  antecedentSupport: number;
  consequentSupport: number;
  confidence: number;
  lift: number;
  leverage: number;
  conviction: number | null;
  score: number;
  rank: number;
}

export interface FilterStages {
  generated: number;
  afterSupport: number;
  afterConfidence: number;
  afterLift: number;
}

export interface MiningResult {
  config: MiningConfig;
  total: number;
  uniqueTransactions: number;
  itemsets: Itemset[];
  rulesGenerated: number;
  stages: FilterStages;
  ranked: Rule[];
  /** lift of every generated rule, for the lift distribution chart */
  allLifts: Float64Array;
  seconds: number;
}

export interface TemporalConfig {
  minTransactionsPerPeriod: number;
  topK: number;
  minRelativeChange: number;
}

export interface PeriodMetric {
  rule: string;
  period: string;
  support: number;
  confidence: number;
  lift: number;
  count: number;
}

export interface TrendRow {
  rule: string;
  trend: "emerging" | "declining" | "stable";
  supportFirst: number;
  supportLast: number;
  supportChange: number;
  liftFirst: number;
  liftLast: number;
  periodsInTopK: number;
}

export interface TemporalResult {
  periods: string[];
  periodSizes: Record<string, number>;
  excluded: Record<string, number>;
  undated: number;
  metrics: PeriodMetric[];
  trends: TrendRow[];
  topByPeriod: Record<string, string[]>;
  stability: { a: string; b: string; jaccard: number }[];
}

export interface AlgorithmRun {
  algorithm: Algorithm;
  seconds: number;
  itemsets: number;
  rules: number;
  surviving: number;
}

export interface ComparisonResult {
  runs: AlgorithmRun[];
  identicalItemsets: boolean;
  identicalRules: boolean;
  jaccard: number;
  maxSupportDifference: number;
}
