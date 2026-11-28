import type { GroupTable, MiningConfig, RankingWeights, Scope, TemporalConfig } from "@/lib/engine/types";

interface Base {
  id: number;
  datasetId: string;
}

export type WorkerRequest =
  | (Base & { type: "dataset"; groups: GroupTable; nItems: number; quarters: string[]; labels: string[] })
  | (Base & { type: "mine"; scope: Scope; config: MiningConfig; weights: RankingWeights })
  | (Base & { type: "compare"; scope: Scope; config: MiningConfig })
  | (Base & { type: "temporal"; scope: Scope; config: MiningConfig; weights: RankingWeights; temporal: TemporalConfig });

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type RequestPayload = DistributiveOmit<WorkerRequest, "id">;
