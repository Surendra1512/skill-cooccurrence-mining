import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { decodeGroups } from "@/lib/engine/decode";
import type { GroupTable } from "@/lib/engine/types";

const DATA = path.resolve(__dirname, "../public/data");

export function loadRealGroups(): GroupTable {
  return decodeGroups(new Uint8Array(gunzipSync(readFileSync(path.join(DATA, "transactions.bin.gz")))));
}

export function loadMeta() {
  return JSON.parse(readFileSync(path.join(DATA, "meta.json"), "utf8"));
}

export function loadReference() {
  return JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/reference.json"), "utf8"));
}
