const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtInt = (v: number) => intFmt.format(Math.round(v));
export const fmtPct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export const fmtNum = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : "—");
export const fmtSec = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n");
}

export function download(fileName: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
