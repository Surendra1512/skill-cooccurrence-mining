"use client";

import { useEffect, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS, useStore } from "@/lib/client/store";
import { fmtInt } from "@/lib/client/format";
import type { Algorithm, MiningConfig, RankingWeights } from "@/lib/engine/types";
import { Button, Segmented, SliderField } from "./ui";

/** Algorithm, thresholds and ranking weights. Changes apply on "Run mining". */
export function MiningSettings({ onApplied }: { onApplied?: () => void }) {
  const { config, weights, apply, tx, mining } = useStore();
  const [draft, setDraft] = useState<MiningConfig>(config);
  const [w, setW] = useState<RankingWeights>(weights);

  useEffect(() => setDraft(config), [config]);
  useEffect(() => setW(weights), [weights]);

  const total = tx?.total ?? 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(config) || JSON.stringify(w) !== JSON.stringify(weights);
  const weightsValid = w.lift + w.confidence + w.support > 0;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!weightsValid) return;
        apply(draft, w);
        onApplied?.();
      }}
    >
      <div>
        <p className="mb-2 text-sm text-fg">Algorithm</p>
        <Segmented<Algorithm> label="Algorithm" options={["FP-Growth", "Apriori"]} value={draft.algorithm} onChange={(algorithm) => setDraft({ ...draft, algorithm })} />
        <p className="mt-2 text-xs leading-snug text-faint">Both return identical results; FP-Growth avoids candidate generation and is usually faster.</p>
      </div>
      <SliderField
        label="Minimum support"
        value={draft.minSupport}
        min={0.002}
        max={0.2}
        step={0.001}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        hint={total ? `A combination must appear in at least ${fmtInt(Math.ceil(draft.minSupport * total))} postings.` : undefined}
        onChange={(minSupport) => setDraft({ ...draft, minSupport })}
      />
      <SliderField
        label="Minimum confidence"
        value={draft.minConfidence}
        min={0.05}
        max={0.95}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        hint="Share of postings with the antecedent that also require the consequent."
        onChange={(minConfidence) => setDraft({ ...draft, minConfidence })}
      />
      <SliderField
        label="Minimum lift"
        value={draft.minLift}
        min={0}
        max={10}
        step={0.1}
        format={(v) => v.toFixed(1)}
        hint="1.0 means independence; keep it above 1 to remove coincidental pairings."
        onChange={(minLift) => setDraft({ ...draft, minLift })}
      />
      <SliderField
        label="Maximum itemset length"
        value={draft.maxLen}
        min={2}
        max={5}
        step={1}
        hint="Largest number of skills in one combination."
        onChange={(maxLen) => setDraft({ ...draft, maxLen })}
      />
      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-1 text-sm text-fg">Ranking weights</legend>
        <div className="flex flex-col gap-4">
          <SliderField label="Lift" value={w.lift} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(lift) => setW({ ...w, lift })} />
          <SliderField label="Confidence" value={w.confidence} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(confidence) => setW({ ...w, confidence })} />
          <SliderField label="Support" value={w.support} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(support) => setW({ ...w, support })} />
          {!weightsValid && <p className="text-xs text-bad">At least one weight must be above zero.</p>}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon={<Play size={15} aria-hidden />} disabled={!weightsValid || mining.status === "running"} className="flex-1">
          {mining.status === "running" ? "Mining…" : dirty ? "Run mining" : "Run again"}
        </Button>
        <Button
          ariaLabel="Reset to defaults"
          icon={<RotateCcw size={15} aria-hidden />}
          onClick={() => {
            setDraft(DEFAULT_CONFIG);
            setW(DEFAULT_WEIGHTS);
          }}
        />
      </div>
    </form>
  );
}
