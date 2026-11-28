/**
 * Skill-name normalisation (TypeScript port of pipeline/src/preprocessing/
 * skill_normalization.py, used for uploaded CSV files):
 * raw → clean → strip generic suffix → synonym map → validate, with a trace.
 */

const ALLOWED = /[^a-z0-9 +#./&-]/g;
const WHITESPACE = /\s+/g;
const EDGE = " .,-/&";
const HAS_LETTER = /[a-z]/;
const STOP = new Set(["n/a", "na", "none", "null", "nan", "other", "others", "etc", "misc", "skills", "tbd"]);
const SUFFIXES = [" programming", " language", " skills", " skill"];

function trimChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
}

export function cleanSkillText(raw: string): string {
  const text = String(raw).toLowerCase().replace(/ /g, " ").replace(ALLOWED, " ").replace(WHITESPACE, " ").trim();
  return trimChars(text, EDGE);
}

export type NormStatus = "kept" | "mapped_synonym" | "removed_invalid";

export class SkillNormalizer {
  private cache = new Map<string, [string, string | null, NormStatus]>();
  private occurrences = new Map<string, number>();
  private synonyms: Map<string, string>;

  constructor(synonyms: Record<string, string>, private maxLength = 60) {
    this.synonyms = new Map(Object.entries(synonyms).map(([k, v]) => [cleanSkillText(k), cleanSkillText(v)]));
  }

  private resolve(raw: string): [string, string | null, NormStatus] {
    const cleaned = cleanSkillText(raw);
    let candidate = cleaned;
    for (const suffix of SUFFIXES) {
      if (candidate.endsWith(suffix) && candidate.length > suffix.length) {
        candidate = candidate.slice(0, -suffix.length).trim();
        break;
      }
    }
    if (candidate.length < 1 || candidate.length > this.maxLength || !HAS_LETTER.test(candidate) || STOP.has(candidate)) {
      return [cleaned, null, "removed_invalid"];
    }
    const canonical = this.synonyms.get(candidate) ?? candidate;
    return [cleaned, canonical, canonical !== cleaned ? "mapped_synonym" : "kept"];
  }

  normalize(raw: string): string | null {
    let r = this.cache.get(raw);
    if (!r) {
      r = this.resolve(raw);
      this.cache.set(raw, r);
    }
    this.occurrences.set(raw, (this.occurrences.get(raw) ?? 0) + 1);
    return r[1];
  }

  normalizeList(raws: string[]): string[] {
    const out = new Set<string>();
    for (const raw of raws) {
      const c = this.normalize(raw);
      if (c) out.add(c);
    }
    return [...out].sort();
  }

  trace(): [string, string, string | null, NormStatus, number][] {
    return [...this.cache.entries()]
      .map(([raw, [cleaned, canonical, status]]) => [raw, cleaned, canonical, status, this.occurrences.get(raw) ?? 0] as [string, string, string | null, NormStatus, number])
      .sort((a, b) => a[3].localeCompare(b[3]) || b[4] - a[4]);
  }
}

export function displayName(token: string, labels: Record<string, string>): string {
  if (labels[token]) return labels[token];
  return token
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Parse a skills cell: Python/JSON list literal or ; | , separated text. */
export function parseSkillCell(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String).filter((v) => v.trim());
  let text = String(value).trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1);
    const quoted = [...inner.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
    if (quoted.length) return quoted;
    text = inner;
  }
  for (const sep of [";", "|", ","]) {
    if (text.includes(sep)) return text.split(sep).map((p) => p.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  return [text.replace(/^['"]|['"]$/g, "")];
}
