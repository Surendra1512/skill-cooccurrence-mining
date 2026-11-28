import type { RequestPayload, WorkerResponse } from "./protocol";

/** Promise wrapper around the mining Web Worker. */
export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL("../../workers/engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Mining worker failed.");
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  request<T>(payload: RequestPayload): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...payload, id });
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
