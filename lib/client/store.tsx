"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildTransactions } from "@/lib/engine/transactions";
import { skillFrequency, type FrequencyRow } from "@/lib/engine/frequency";
import type {
  ComparisonResult,
  Dataset,
  MiningConfig,
  MiningResult,
  RankingWeights,
  Rule,
  Scope,
  TemporalConfig,
  TemporalResult,
  Transactions,
} from "@/lib/engine/types";
import { EngineClient } from "./engine-client";
import { loadReferenceDataset, type ReferenceMeta } from "./load";

export const DEFAULT_CONFIG: MiningConfig = { algorithm: "FP-Growth", minSupport: 0.01, minConfidence: 0.3, minLift: 1.2, maxLen: 3 };
export const DEFAULT_WEIGHTS: RankingWeights = { lift: 0.4, confidence: 0.4, support: 0.2 };
export const DEFAULT_TEMPORAL: TemporalConfig = { minTransactionsPerPeriod: 5000, topK: 25, minRelativeChange: 0.15 };
const ALL: Scope = { roles: [], countries: [] };

type Async<T> = { status: "idle" | "running" | "done" | "error"; result?: T; error?: string };

interface Store {
  status: "loading" | "ready" | "error";
  loadError?: string;
  meta: ReferenceMeta | null;
  datasets: Dataset[];
  dataset: Dataset | null;
  setActive: (id: string) => void;
  addDataset: (d: Dataset) => Promise<void>;
  scope: Scope;
  setScope: (s: Scope) => void;
  config: MiningConfig;
  weights: RankingWeights;
  apply: (config: MiningConfig, weights: RankingWeights) => void;
  mining: Async<MiningResult>;
  tx: Transactions | null;
  frequency: FrequencyRow[];
  label: (id: number) => string;
  setLabel: (ids: number[]) => string;
  ruleLabel: (r: Pick<Rule, "antecedent" | "consequent">) => string;
  compare: () => Promise<ComparisonResult>;
  temporal: (t: TemporalConfig) => Promise<TemporalResult>;
  scopeText: string;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const engine = useRef<EngineClient | null>(null);
  const cache = useRef(new Map<string, Promise<unknown>>());
  const [status, setStatus] = useState<Store["status"]>("loading");
  const [loadError, setLoadError] = useState<string>();
  const [meta, setMeta] = useState<ReferenceMeta | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeId, setActiveId] = useState("reference");
  const [scope, setScopeState] = useState<Scope>(ALL);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [mining, setMining] = useState<Async<MiningResult>>({ status: "idle" });

  const sendDataset = useCallback(async (d: Dataset) => {
    await engine.current!.request({
      type: "dataset",
      datasetId: d.id,
      groups: d.groups,
      nItems: d.skills.length,
      quarters: d.quarters,
      labels: d.skills.map((s) => s.label),
    });
  }, []);

  useEffect(() => {
    engine.current = new EngineClient();
    let cancelled = false;
    loadReferenceDataset()
      .then(async ({ meta: m, dataset }) => {
        await sendDataset(dataset);
        if (cancelled) return;
        setMeta(m);
        setDatasets([dataset]);
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      engine.current?.terminate();
    };
  }, [sendDataset]);

  const dataset = datasets.find((d) => d.id === activeId) ?? datasets[0] ?? null;

  const cached = useCallback(<T,>(key: string, run: () => Promise<T>): Promise<T> => {
    let p = cache.current.get(key) as Promise<T> | undefined;
    if (!p) {
      p = run();
      p.catch(() => cache.current.delete(key));
      cache.current.set(key, p);
    }
    return p;
  }, []);

  useEffect(() => {
    if (!dataset || status !== "ready") return;
    let current = true;
    setMining((m) => ({ status: "running", result: m.result }));
    const key = JSON.stringify(["mine", dataset.id, scope, config, weights]);
    cached(key, () => engine.current!.request<MiningResult>({ type: "mine", datasetId: dataset.id, scope, config, weights }))
      .then((result) => current && setMining({ status: "done", result }))
      .catch((e: Error) => current && setMining({ status: "error", error: e.message }));
    return () => {
      current = false;
    };
  }, [dataset, scope, config, weights, status, cached]);

  const tx = useMemo(() => (dataset ? buildTransactions(dataset.groups, scope, dataset.skills.length) : null), [dataset, scope]);
  const frequency = useMemo(() => (tx ? skillFrequency(tx) : []), [tx]);

  const label = useCallback((id: number) => dataset?.skills[id]?.label ?? String(id), [dataset]);
  const setLabel = useCallback((ids: number[]) => ids.map(label).sort((a, b) => a.localeCompare(b)).join(" + "), [label]);
  const ruleLabel = useCallback((r: Pick<Rule, "antecedent" | "consequent">) => `${setLabel(r.antecedent)} → ${setLabel(r.consequent)}`, [setLabel]);

  const compare = useCallback(() => {
    if (!dataset) return Promise.reject(new Error("No dataset"));
    return cached(JSON.stringify(["compare", dataset.id, scope, config]), () =>
      engine.current!.request<ComparisonResult>({ type: "compare", datasetId: dataset.id, scope, config }),
    );
  }, [dataset, scope, config, cached]);

  const temporal = useCallback(
    (t: TemporalConfig) => {
      if (!dataset) return Promise.reject(new Error("No dataset"));
      return cached(JSON.stringify(["temporal", dataset.id, scope, config, weights, t]), () =>
        engine.current!.request<TemporalResult>({ type: "temporal", datasetId: dataset.id, scope, config, weights, temporal: t }),
      );
    },
    [dataset, scope, config, weights, cached],
  );

  const addDataset = useCallback(
    async (d: Dataset) => {
      await sendDataset(d);
      setDatasets((list) => [...list.filter((x) => x.id !== d.id), d]);
      setScopeState(ALL);
      setActiveId(d.id);
    },
    [sendDataset],
  );

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    setScopeState(ALL);
  }, []);

  const apply = useCallback((c: MiningConfig, w: RankingWeights) => {
    setConfig(c);
    setWeights(w);
  }, []);

  const scopeText = useMemo(() => {
    if (!dataset) return "";
    const roles = scope.roles.length ? scope.roles.map((r) => dataset.roles[r]).join(", ") : "All roles";
    const countries = scope.countries.length ? scope.countries.map((c) => dataset.countries[c]).join(", ") : "all countries";
    return `${roles}; ${countries}`;
  }, [dataset, scope]);

  const value: Store = {
    status,
    loadError,
    meta,
    datasets,
    dataset,
    setActive,
    addDataset,
    scope,
    setScope: setScopeState,
    config,
    weights,
    apply,
    mining,
    tx,
    frequency,
    label,
    setLabel,
    ruleLabel,
    compare,
    temporal,
    scopeText,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
