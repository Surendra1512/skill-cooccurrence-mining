import { UNDATED } from "./decode";
import { displayName, parseSkillCell, SkillNormalizer } from "./normalize";
import type { Dataset, GroupTable, PreprocessingReport, SkillMeta } from "./types";

/**
 * Build a Dataset from uploaded CSV rows (e.g. a cooperative's own vacancy
 * records) with the same cleaning rules as the Python pipeline:
 * missing categoricals → "Unknown", duplicate ids removed, skills normalised,
 * postings without skills removed, content duplicates removed only when every
 * key field (employer, title, location, date) is known.
 */
export interface ColumnMapping {
  skills: string;
  jobId?: string;
  role?: string;
  title?: string;
  date?: string;
  country?: string;
  company?: string;
  location?: string;
}

const UNKNOWN = "Unknown";

function quarterOf(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const t = Date.parse(String(value));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

const text = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

export function buildUploadDataset(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  fileName: string,
  synonyms: Record<string, string>,
  displayNames: Record<string, string>,
  prerequisites: Record<string, string[]>,
): Dataset {
  if (!mapping.skills) throw new Error("Select the skills column.");
  const columns = new Set(Object.keys(rows[0] ?? {}));
  for (const c of Object.values(mapping)) if (c && !columns.has(c)) throw new Error(`Missing column in CSV: ${c}`);

  const normalizer = new SkillNormalizer(synonyms);
  const missing: Record<string, number> = {};
  const count = (k: string) => (missing[k] = (missing[k] ?? 0) + 1);
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  let dupIds = 0;
  let dupContent = 0;
  let noSkills = 0;
  let undatedCount = 0;

  interface Posting { skills: string[]; role: string; country: string; quarter: string | null; date: number | null }
  const postings: Posting[] = [];

  rows.forEach((row, i) => {
    const id = mapping.jobId ? text(row[mapping.jobId]) ?? `row-${i}` : `row-${i}`;
    if (seenIds.has(id)) {
      dupIds++;
      return;
    }
    seenIds.add(id);
    const role = mapping.role ? text(row[mapping.role]) : null;
    const country = mapping.country ? text(row[mapping.country]) : null;
    const company = mapping.company ? text(row[mapping.company]) : null;
    const title = mapping.title ? text(row[mapping.title]) : null;
    const location = mapping.location ? text(row[mapping.location]) : null;
    const rawDate = mapping.date ? row[mapping.date] : null;
    if (mapping.role && !role) count("role");
    if (mapping.country && !country) count("country");
    const quarter = mapping.date ? quarterOf(rawDate) : null;
    if (mapping.date && !quarter) undatedCount++;

    const skills = normalizer.normalizeList(parseSkillCell(row[mapping.skills]));
    if (skills.length === 0) {
      noSkills++;
      return;
    }
    if (company && title && location && quarter) {
      const key = [company, title, location, String(rawDate), skills.join("|")].join("\u0001");
      if (seenContent.has(key)) {
        dupContent++;
        return;
      }
      seenContent.add(key);
    }
    const t = rawDate ? Date.parse(String(rawDate)) : NaN;
    postings.push({ skills, role: role ?? UNKNOWN, country: country ?? UNKNOWN, quarter, date: Number.isNaN(t) ? null : t });
  });

  if (postings.length === 0) throw new Error("No posting with a valid skill was found in the file.");

  // Vocabulary ordered by frequency.
  const freq = new Map<string, number>();
  for (const p of postings) for (const s of p.skills) freq.set(s, (freq.get(s) ?? 0) + 1);
  const vocab = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (vocab.length > 65_000) throw new Error("Too many distinct skills in the file.");
  const skillId = new Map(vocab.map(([s], i) => [s, i]));

  const tally = (values: string[]) => {
    const m = new Map<string, number>();
    values.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  // uint8 storage: keep the 254 most common values and fold the rest into "Other".
  const capped = (values: string[]) => (values.length <= 255 ? values : [...values.slice(0, 254), "Other"]);
  const roles = capped(tally(postings.map((p) => p.role)));
  const countries = capped(tally(postings.map((p) => p.country)));
  const roleId = new Map(roles.map((r, i) => [r, i]));
  const countryId = new Map(countries.map((c, i) => [c, i]));
  const otherRole = roles.length - 1;
  const otherCountry = countries.length - 1;
  const quarters = [...new Set(postings.map((p) => p.quarter).filter((q): q is string => !!q))].sort().slice(0, 254);
  const quarterId = new Map(quarters.map((q, i) => [q, i]));

  const groupsMap = new Map<string, { role: number; country: number; quarter: number; items: number[]; weight: number }>();
  for (const p of postings) {
    const items = p.skills.map((s) => skillId.get(s)!).sort((a, b) => a - b);
    const role = roleId.get(p.role) ?? otherRole;
    const country = countryId.get(p.country) ?? otherCountry;
    const quarter = p.quarter && quarterId.has(p.quarter) ? quarterId.get(p.quarter)! : UNDATED;
    const key = `${role}|${country}|${quarter}|${items.join(",")}`;
    const g = groupsMap.get(key);
    if (g) g.weight++;
    else groupsMap.set(key, { role, country, quarter, items, weight: 1 });
  }
  const list = [...groupsMap.values()];
  const offsets = new Uint32Array(list.length + 1);
  const flat: number[] = [];
  list.forEach((g, i) => {
    offsets[i] = flat.length;
    flat.push(...g.items);
  });
  offsets[list.length] = flat.length;
  const groups: GroupTable = {
    n: list.length,
    role: Uint8Array.from(list, (g) => g.role),
    country: Uint8Array.from(list, (g) => g.country),
    quarter: Uint8Array.from(list, (g) => g.quarter),
    weight: Uint32Array.from(list, (g) => g.weight),
    offsets,
    items: Uint16Array.from(flat),
  };

  const trace = normalizer.trace();
  const variants = new Map<string, Set<string>>();
  for (const [raw, , canonical] of trace) if (canonical) variants.set(canonical, (variants.get(canonical) ?? new Set()).add(raw));
  const skills: SkillMeta[] = vocab.map(([key, n], id) => ({
    id,
    key,
    label: displayName(key, displayNames),
    category: "uncategorised",
    postings: n,
    variants: [...(variants.get(key) ?? [key])].sort().join(", "),
  }));

  const sizes = postings.map((p) => p.skills.length).sort((a, b) => a - b);
  const dates = postings.map((p) => p.date).filter((d): d is number => d !== null);
  const report: PreprocessingReport = {
    source: fileName,
    original_records: rows.length,
    cleaned_records: postings.length,
    duplicate_records_removed: dupIds + dupContent,
    duplicate_ids_removed: dupIds,
    duplicate_content_removed: dupContent,
    missing_job_id_removed: 0,
    postings_without_skills_removed: noSkills,
    missing_values_by_column: missing,
    unparseable_dates: undatedCount,
    distinct_raw_skill_strings: trace.length,
    synonym_variants_merged: trace.filter((t) => t[3] === "mapped_synonym").length,
    invalid_skill_strings_removed: trace.filter((t) => t[3] === "removed_invalid").length,
    unique_skills: vocab.length,
    total_transactions: postings.length,
    total_skill_mentions: sizes.reduce((a, b) => a + b, 0),
    avg_skills_per_transaction: +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(3),
    median_skills_per_transaction: sizes[Math.floor(sizes.length / 2)],
    single_skill_transactions: sizes.filter((s) => s === 1).length,
    date_min: dates.length ? new Date(dates.reduce((a, b) => Math.min(a, b))).toISOString() : null,
    date_max: dates.length ? new Date(dates.reduce((a, b) => Math.max(a, b))).toISOString() : null,
  };

  return {
    id: `upload:${fileName}:${rows.length}`,
    label: `Uploaded — ${fileName}`,
    kind: "upload",
    skills,
    roles,
    countries,
    quarters,
    groups,
    report,
    trace,
    prerequisites,
  };
}
