"use client";

import type { ReactNode } from "react";
import { useStore } from "@/lib/client/store";
import type { MiningResult } from "@/lib/engine/types";
import { Callout, Loading } from "./ui";

/** Renders children with the current mining result, or a clear status. */
export function WithMining({ children }: { children: (result: MiningResult) => ReactNode }) {
  const { mining } = useStore();
  if (mining.status === "error") return <Callout tone="warn">Mining could not run: {mining.error}</Callout>;
  if (!mining.result) return <Loading label="Mining frequent itemsets and association rules…" />;
  return (
    <div className={mining.status === "running" ? "opacity-60 transition-opacity" : undefined} aria-busy={mining.status === "running"}>
      {children(mining.result)}
    </div>
  );
}
