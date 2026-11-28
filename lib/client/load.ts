import { decodeGroups, isGzip } from "@/lib/engine/decode";
import type { Dataset, PreprocessingReport, SkillMeta, TraceRow } from "@/lib/engine/types";

export interface ReferenceMeta {
  version: number;
  generatedAt: string;
  source: {
    key: string;
    title: string;
    publisher: string;
    originalUrl: string;
    mirrorUrl: string;
    licence: string;
    description: string;
    files: { name: string; sha256: string }[];
  };
  skills: SkillMeta[];
  roles: string[];
  countries: string[];
  quarters: string[];
  nTransactions: number;
  nGroups: number;
  report: PreprocessingReport & { top_skills: { label: string; postings: number; share: number }[] };
  trace: TraceRow[];
  synonyms: Record<string, string>;
  displayNames: Record<string, string>;
  prerequisites: Record<string, string[]>;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  // Some hosts transparently decompress .gz responses; only inflate real gzip.
  if (!isGzip(bytes)) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadReferenceDataset(): Promise<{ meta: ReferenceMeta; dataset: Dataset }> {
  const [metaRes, binRes] = await Promise.all([fetch("/data/meta.json"), fetch("/data/transactions.bin.gz")]);
  if (!metaRes.ok || !binRes.ok) throw new Error("Could not download the dataset files.");
  const meta = (await metaRes.json()) as ReferenceMeta;
  const groups = decodeGroups(await gunzip(new Uint8Array(await binRes.arrayBuffer())));
  let total = 0;
  for (let g = 0; g < groups.n; g++) total += groups.weight[g];
  if (total !== meta.nTransactions) throw new Error("Dataset integrity check failed (posting count mismatch).");
  return {
    meta,
    dataset: {
      id: "reference",
      label: "Data Jobs 2023 (real postings)",
      kind: "reference",
      skills: meta.skills,
      roles: meta.roles,
      countries: meta.countries,
      quarters: meta.quarters,
      groups,
      report: meta.report,
      trace: meta.trace,
      prerequisites: meta.prerequisites,
    },
  };
}
