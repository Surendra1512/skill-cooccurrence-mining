"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string;
  align?: "left" | "right";
  width?: string;
  title?: string;
}

/** Sortable, paginated, semantic data table. */
export function DataTable<T>({
  rows,
  columns,
  pageSize = 15,
  caption,
  initialSort,
  rowKey,
  dense,
}: {
  rows: T[];
  columns: Column<T>[];
  pageSize?: number;
  caption?: string;
  initialSort?: { key: string; desc: boolean };
  rowKey: (row: T, index: number) => string;
  dense?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.desc ? -r : r;
    });
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize);

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-ink-2">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ width: c.width }}
                    title={c.title}
                    aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined}
                    className={cx("border-b border-line px-3 py-2.5 font-medium whitespace-nowrap text-muted", c.align === "right" ? "text-right" : "text-left")}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSort(active ? { key: c.key, desc: !sort!.desc } : { key: c.key, desc: true });
                          setPage(0);
                        }}
                        className={cx("inline-flex items-center gap-1 hover:text-fg", c.align === "right" && "flex-row-reverse")}
                      >
                        {c.header}
                        {active && (sort!.desc ? <ArrowDown size={13} aria-hidden /> : <ArrowUp size={13} aria-hidden />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={rowKey(row, current * pageSize + i)} className="border-b border-line/70 last:border-0 hover:bg-panel-2/60">
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-3 text-fg/95", dense ? "py-1.5" : "py-2.5", c.align === "right" && "text-right whitespace-nowrap")}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted">
                  Nothing to show for the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="flex items-center justify-between border-t border-line bg-ink-2 px-3 py-2 text-xs text-muted">
          <span>
            {(current * pageSize + 1).toLocaleString()}–{Math.min((current + 1) * pageSize, sorted.length).toLocaleString()} of {sorted.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded p-1.5 hover:bg-panel-2 hover:text-fg disabled:opacity-30">
              <ChevronLeft size={15} aria-hidden />
            </button>
            <span>
              Page {current + 1} of {pages.toLocaleString()}
            </span>
            <button type="button" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded p-1.5 hover:bg-panel-2 hover:text-fg disabled:opacity-30">
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Thin horizontal bar used inside table cells for scores and shares. */
export function Meter({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <span className="inline-flex w-full min-w-[5rem] items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-signal" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
