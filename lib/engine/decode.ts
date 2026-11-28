import type { GroupTable } from "./types";

export const UNDATED = 255;
const MAGIC = "SKM1";

/** True when the bytes start with the gzip signature. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Decode the binary transaction file written by `pipeline/scripts/export_web.py`.
 * Layout: "SKM1", uint32 groups, then per group role, country, quarter (uint8),
 * weight (varint), n (uint8), n skill ids (uint8).
 */
export function decodeGroups(bytes: Uint8Array): GroupTable {
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) throw new Error("Unrecognised transaction file (bad header).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(4, true);

  const role = new Uint8Array(n);
  const country = new Uint8Array(n);
  const quarter = new Uint8Array(n);
  const weight = new Uint32Array(n);
  const offsets = new Uint32Array(n + 1);
  const itemsTmp: number[] = [];

  let pos = 8;
  for (let g = 0; g < n; g++) {
    role[g] = bytes[pos++];
    country[g] = bytes[pos++];
    quarter[g] = bytes[pos++];
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[pos++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    weight[g] = value;
    const k = bytes[pos++];
    offsets[g] = itemsTmp.length;
    for (let i = 0; i < k; i++) itemsTmp.push(bytes[pos++]);
  }
  offsets[n] = itemsTmp.length;
  if (pos !== bytes.length) throw new Error("Transaction file has trailing or missing bytes.");
  return { n, role, country, quarter, weight, offsets, items: Uint16Array.from(itemsTmp) };
}
