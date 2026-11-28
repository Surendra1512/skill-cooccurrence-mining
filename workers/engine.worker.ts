/// <reference lib="webworker" />
import { compareAlgorithms, runMining } from "@/lib/engine/engine";
import { analyseTemporal } from "@/lib/engine/temporal";
import { buildTransactions } from "@/lib/engine/transactions";
import type { GroupTable, Transactions } from "@/lib/engine/types";
import type { WorkerRequest, WorkerResponse } from "@/lib/client/protocol";

/**
 * Mining runs here so the interface stays responsive while Apriori /
 * FP-Growth process hundreds of thousands of postings.
 */
interface StoredDataset {
  groups: GroupTable;
  nItems: number;
  quarters: string[];
  labels: string[];
}

const datasets = new Map<string, StoredDataset>();
const txCache = new Map<string, Transactions>();

function transactions(datasetId: string, scopeKey: string, build: () => Transactions): Transactions {
  const key = `${datasetId}|${scopeKey}`;
  let tx = txCache.get(key);
  if (!tx) {
    if (txCache.size > 6) txCache.delete(txCache.keys().next().value!);
    tx = build();
    txCache.set(key, tx);
  }
  return tx;
}

function handle(msg: WorkerRequest): unknown {
  if (msg.type === "dataset") {
    datasets.set(msg.datasetId, { groups: msg.groups, nItems: msg.nItems, quarters: msg.quarters, labels: msg.labels });
    return true;
  }
  const ds = datasets.get(msg.datasetId);
  if (!ds) throw new Error("Dataset not loaded in the mining worker.");
  const scopeKey = JSON.stringify(msg.scope);
  const tx = transactions(msg.datasetId, scopeKey, () => buildTransactions(ds.groups, msg.scope, ds.nItems));

  switch (msg.type) {
    case "mine":
      return runMining(tx, msg.config, msg.weights);
    case "compare":
      return compareAlgorithms(tx, msg.config);
    case "temporal": {
      const name = (ids: number[]) => ids.map((i) => ds.labels[i]).sort().join(" + ");
      return analyseTemporal(ds.groups, msg.scope, ds.nItems, ds.quarters, msg.config, msg.temporal, msg.weights,
        (r) => `${name(r.antecedent)} → ${name(r.consequent)}`);
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  let response: WorkerResponse;
  try {
    response = { id: msg.id, ok: true, result: handle(msg) };
  } catch (error) {
    response = { id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as Worker).postMessage(response);
};
