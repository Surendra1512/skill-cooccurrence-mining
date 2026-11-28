"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { cx } from "./ui";

export const SERIES = ["#338ced", "#e76624", "#00a888", "#d28e05", "#e24d8b", "#0aac23", "#9887ef", "#eb6263"];
const SEQ = ["#16335d", "#1757ac", "#338ced", "#84b9f3", "#cce3fd"];
const AXIS = { stroke: "#2a4468", tick: { fill: "#8fa3bf", fontSize: 12 } };

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Single-hue sequential ramp for the dark surface (low → near surface). */
export function seqColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (SEQ.length - 1);
  const i = Math.min(Math.floor(x), SEQ.length - 2);
  const f = x - i;
  const a = hexToRgb(SEQ[i]);
  const b = hexToRgb(SEQ[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function ChartFrame({ title, subtitle, children, className, actions }: { title: string; subtitle?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <figure className={cx("rounded-2xl border border-line bg-panel p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <figcaption>
          <span className="block text-[0.98rem] font-semibold text-fg">{title}</span>
          {subtitle && <span className="mt-1 block text-sm leading-snug text-muted">{subtitle}</span>}
        </figcaption>
        {actions}
      </div>
      {children}
    </figure>
  );
}

interface TipRow {
  label: string;
  value: string;
  color?: string;
}

function TipBox({ title, rows }: { title?: string; rows: TipRow[] }) {
  return (
    <div className="max-w-xs rounded-lg border border-line-2 bg-ink-2/95 px-3 py-2 text-xs shadow-xl shadow-black/40 backdrop-blur">
      {title && <div className="mb-1 font-medium text-fg">{title}</div>}
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 text-muted">
          <span className="inline-flex items-center gap-1.5">
            {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-medium text-fg">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal bars                                                     */
/* ------------------------------------------------------------------ */
export interface BarDatum {
  label: string;
  value: number;
  tip?: TipRow[];
}

export function HBar({ data, format, domainMax, color = SERIES[0], labelWidth = 130 }: { data: BarDatum[]; format: (v: number) => string; domainMax?: number; color?: string; labelWidth?: number }) {
  const height = Math.max(110, data.length * 28 + 40);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} strokeDasharray="0" />
          <XAxis type="number" domain={[0, domainMax ?? "auto"]} tickFormatter={format} {...AXIS} />
          <YAxis type="category" dataKey="label" width={labelWidth} {...AXIS} tick={{ fill: "#c9d4e5", fontSize: 12 }} interval={0} />
          <Tooltip
            cursor={{ fill: "rgba(51,140,237,0.08)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TipBox title={(payload[0].payload as BarDatum).label} rows={(payload[0].payload as BarDatum).tip ?? [{ label: "Value", value: format(payload[0].value as number) }]} />
              ) : null
            }
          />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} label={{ position: "right", fill: "#c9d4e5", fontSize: 11, formatter: (v: unknown) => format(Number(v)) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vertical bars (histograms, distributions)                           */
/* ------------------------------------------------------------------ */
export function VBar({ data, xLabel, yFormat, references = [], height = 280 }: {
  data: { x: string; value: number; tip?: TipRow[] }[];
  xLabel: string;
  yFormat: (v: number) => string;
  references?: { x: string; label: string; color?: string; dashed?: boolean }[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 12, bottom: 18, left: 4 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="x" {...AXIS} interval="preserveStartEnd" label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "#8fa3bf", fontSize: 12 }} />
          <YAxis tickFormatter={yFormat} {...AXIS} width={56} />
          <Tooltip
            cursor={{ fill: "rgba(51,140,237,0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { x: string; value: number; tip?: TipRow[] };
              return <TipBox title={`${xLabel}: ${d.x}`} rows={d.tip ?? [{ label: "Count", value: yFormat(d.value) }]} />;
            }}
          />
          {references.map((r) => (
            <ReferenceLine key={r.label} x={r.x} stroke={r.color ?? "#e8edf5"} strokeDasharray={r.dashed ? "4 4" : undefined} strokeWidth={1.5} label={{ value: r.label, position: "top", fill: r.color ?? "#e8edf5", fontSize: 11 }} />
          ))}
          <Bar dataKey="value" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-series lines                                                   */
/* ------------------------------------------------------------------ */
export function Lines({ data, series, format, yLabel, height = 340 }: { data: Record<string, number | string>[]; series: string[]; format: (v: number) => string; yLabel: string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="period" {...AXIS} />
          <YAxis tickFormatter={format} {...AXIS} width={64} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "#8fa3bf", fontSize: 12, dy: 40 }} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox title={String(label)} rows={payload.map((p) => ({ label: String(p.name), value: format(Number(p.value)), color: p.color }))} />
              ) : null
            }
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="plainline" />
          {series.map((s, i) => (
            <Line key={s} type="linear" dataKey={s} name={s} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#101f36", fill: SERIES[i % SERIES.length] }} activeDot={{ r: 6, fill: SERIES[i % SERIES.length] }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Support vs confidence scatter (colour = lift)                        */
/* ------------------------------------------------------------------ */
export function SupportConfidence({ points }: { points: { support: number; confidence: number; lift: number; label: string }[] }) {
  const maxLift = Math.max(...points.map((p) => Math.log2(p.lift)), 1);
  return (
    <div style={{ height: 380 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="support" scale="log" domain={["auto", "auto"]} tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} {...AXIS} label={{ value: "Support (log scale)", position: "insideBottom", offset: -10, fill: "#8fa3bf", fontSize: 12 }} />
          <YAxis type="number" dataKey="confidence" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} width={48} />
          <ZAxis range={[36, 36]} />
          <Tooltip
            cursor={{ stroke: "#2a4468" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { support: number; confidence: number; lift: number; label: string };
              return <TipBox title={p.label} rows={[{ label: "Support", value: `${(p.support * 100).toFixed(2)}%` }, { label: "Confidence", value: `${(p.confidence * 100).toFixed(1)}%` }, { label: "Lift", value: p.lift.toFixed(2) }]} />;
            }}
          />
          <Scatter data={points} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell key={i} fill={seqColor(0.15 + 0.85 * (Math.log2(p.lift) / maxLift))} stroke="#101f36" strokeWidth={1} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Side-by-side bars for two measures (never a dual axis)              */
/* ------------------------------------------------------------------ */
export function PairedBars({ data, leftLabel, rightLabel, leftFormat, rightFormat, rightReference }: {
  data: { label: string; left: number; right: number }[];
  leftLabel: string;
  rightLabel: string;
  leftFormat: (v: number) => string;
  rightFormat: (v: number) => string;
  rightReference?: number;
}) {
  const height = Math.max(90, data.length * 32 + 50);
  const chart = (key: "left" | "right", label: string, format: (v: number) => string, showNames: boolean, ref?: number) => (
    <div>
      <p className="mb-2 text-sm text-muted">{label}</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickFormatter={format} {...AXIS} />
            <YAxis type="category" dataKey="label" width={showNames ? 110 : 0} hide={!showNames} {...AXIS} tick={{ fill: "#c9d4e5", fontSize: 12 }} interval={0} />
            {ref !== undefined && <ReferenceLine x={ref} stroke="#8fa3bf" strokeDasharray="4 4" />}
            <Tooltip cursor={{ fill: "rgba(51,140,237,0.08)" }} content={({ active, payload }) => (active && payload?.length ? <TipBox title={(payload[0].payload as { label: string }).label} rows={[{ label, value: format(Number(payload[0].value)) }]} /> : null)} />
            <Bar dataKey={key} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} label={{ position: "right", fill: "#c9d4e5", fontSize: 11, formatter: (v: unknown) => format(Number(v)) }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
  return (
    <div className="grid gap-6 md:grid-cols-[1.25fr_1fr]">
      {chart("left", leftLabel, leftFormat, true)}
      {chart("right", rightLabel, rightFormat, false, rightReference)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grouped bars: first vs last period                                  */
/* ------------------------------------------------------------------ */
export function FirstLastBars({ data, first, last, format }: { data: { label: string; first: number; last: number }[]; first: string; last: string; format: (v: number) => string }) {
  const height = Math.max(200, data.length * 40 + 60);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }} barCategoryGap={8} barGap={2}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickFormatter={format} {...AXIS} />
          <YAxis type="category" dataKey="label" width={250} {...AXIS} tick={{ fill: "#c9d4e5", fontSize: 11.5 }} interval={0} />
          <Tooltip cursor={{ fill: "rgba(51,140,237,0.08)" }} content={({ active, payload, label }) => (active && payload?.length ? <TipBox title={String(label)} rows={payload.map((p) => ({ label: String(p.name), value: format(Number(p.value)), color: p.color }))} /> : null)} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="first" name={first} fill={SERIES[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar dataKey="last" name={last} fill={SERIES[1]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Heatmap (SVG)                                                        */
/* ------------------------------------------------------------------ */
export function Heatmap({ rows, cols, values, format, cellTip, diagonalBlank, colorDomain }: {
  rows: string[];
  cols: string[];
  values: number[][];
  format: (v: number) => string;
  cellTip?: (r: number, c: number) => TipRow[];
  diagonalBlank?: boolean;
  colorDomain?: [number, number];
}) {
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const cell = 30;
  const left = Math.min(200, Math.max(...rows.map((r) => r.length)) * 7 + 16);
  const top = Math.min(130, Math.max(...cols.map((c) => c.length)) * 6 + 16);
  const width = left + cols.length * cell;
  const height = top + rows.length * cell;
  const flat = values.flatMap((row, r) => row.filter((_, c) => !(diagonalBlank && r === c)));
  const [lo, hi] = colorDomain ?? [Math.min(...flat), Math.max(...flat)];
  const t = (v: number) => (hi - lo < 1e-12 ? 1 : (v - lo) / (hi - lo));

  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Heatmap" className="max-w-none">
        {cols.map((c, i) => (
          <text key={c} transform={`translate(${left + i * cell + cell / 2},${top - 8}) rotate(-50)`} fontSize={11} fill="#8fa3bf">
            {c}
          </text>
        ))}
        {rows.map((r, i) => (
          <text key={r} x={left - 8} y={top + i * cell + cell / 2 + 4} fontSize={11.5} fill="#c9d4e5" textAnchor="end">
            {r}
          </text>
        ))}
        {values.map((row, r) =>
          row.map((v, c) => {
            const blank = diagonalBlank && r === c;
            return (
              <rect
                key={`${r}-${c}`}
                x={left + c * cell + 1}
                y={top + r * cell + 1}
                width={cell - 2}
                height={cell - 2}
                rx={4}
                fill={blank ? "#0d1b30" : seqColor(t(v))}
                stroke={hover && hover.r === r && hover.c === c ? "#e8edf5" : "none"}
                onMouseEnter={(e) => !blank && setHover({ r, c, x: (e.target as SVGRectElement).getBoundingClientRect().left, y: (e.target as SVGRectElement).getBoundingClientRect().top })}
                onMouseLeave={() => setHover(null)}
              />
            );
          }),
        )}
      </svg>
      {hover && (
        <div className="pointer-events-none fixed z-50" style={{ left: hover.x + 34, top: hover.y - 8 }}>
          <TipBox title={`${rows[hover.r]} × ${cols[hover.c]}`} rows={cellTip ? cellTip(hover.r, hover.c) : [{ label: "Value", value: format(values[hover.r][hover.c]) }]} />
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span>{format(lo)}</span>
        <span className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${SEQ.join(",")})` }} />
        <span>{format(hi)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skill network (force-directed, computed once per data change)       */
/* ------------------------------------------------------------------ */
export interface NetNode {
  id: number;
  label: string;
  share: number;
}
export interface NetLink {
  source: number;
  target: number;
  lift: number;
  confidence: number;
  support: number;
}

type SimNode = NetNode & SimulationNodeDatum & { r: number; degree: number };
type SimLink = SimulationLinkDatum<SimNode> & NetLink;

export function SkillNetwork({ nodes, links, height = 560, variant = "default", labelTop = 28 }: { nodes: NetNode[]; links: NetLink[]; height?: number; variant?: "default" | "hero"; labelTop?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 1000;

  const layout = useMemo(() => {
    const maxShare = Math.max(...nodes.map((n) => n.share), 1e-9);
    const degree = new Map<number, number>();
    links.forEach((l) => {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    });
    const sim: SimNode[] = nodes.map((n) => ({ ...n, r: 6 + 22 * Math.sqrt(n.share / maxShare), degree: degree.get(n.id) ?? 0 }));
    const simLinks: SimLink[] = links.map((l) => ({ ...l }));
    const lifts = links.map((l) => Math.log2(l.lift));
    const lo = Math.min(...lifts);
    const hi = Math.max(...lifts);
    const simulation = forceSimulation(sim)
      .force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(70).strength(0.4))
      .force("charge", forceManyBody().strength(-180))
      .force("collide", forceCollide<SimNode>((d) => d.r + 16))
      .force("x", forceX(width / 2).strength(0.05))
      .force("y", forceY(height / 2).strength(0.08))
      .force("center", forceCenter(width / 2, height / 2))
      .stop();
    for (let i = 0; i < 320; i++) simulation.tick();
    // Fit into the viewBox.
    const pad = 40;
    const xs = sim.map((n) => n.x!);
    const ys = sim.map((n) => n.y!);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((width - 2 * pad) / Math.max(x1 - x0, 1), (height - 2 * pad) / Math.max(y1 - y0, 1), 3);
    sim.forEach((n) => {
      n.x = pad + (n.x! - x0) * s + ((width - 2 * pad) - (x1 - x0) * s) / 2;
      n.y = pad + (n.y! - y0) * s + ((height - 2 * pad) - (y1 - y0) * s) / 2;
    });
    const labelled = new Set([...sim].sort((a, b) => b.share - a.share).slice(0, labelTop).map((n) => n.id));
    return { sim, simLinks, liftT: (l: number) => (hi - lo < 1e-9 ? 0.5 : (Math.log2(l) - lo) / (hi - lo)), maxShare, labelled };
  }, [nodes, links, height, labelTop]);

  if (nodes.length === 0) return null;
  const neighbours = new Set<number>();
  if (hover !== null)
    layout.simLinks.forEach((l) => {
      const s = (l.source as SimNode).id;
      const t = (l.target as SimNode).id;
      if (s === hover) neighbours.add(t);
      if (t === hover) neighbours.add(s);
    });
  const hovered = layout.sim.find((n) => n.id === hover);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="group" aria-label="Skill relationship network">
        <defs>
          <radialGradient id={`glow-${variant}`}>
            <stop offset="0%" stopColor="#338ced" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#338ced" stopOpacity={0} />
          </radialGradient>
        </defs>
        {layout.simLinks.map((l, i) => {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
          const active = hover === null || s.id === hover || t.id === hover;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={active && hover !== null ? "#84b9f3" : "#338ced"}
              strokeOpacity={active ? 0.2 + 0.55 * layout.liftT(l.lift) : 0.05}
              strokeWidth={1 + 4 * layout.liftT(l.lift)}
            />
          );
        })}
        {layout.sim.map((n) => {
          const dim = hover !== null && n.id !== hover && !neighbours.has(n.id);
          const showLabel = layout.labelled.has(n.id) || n.id === hover || neighbours.has(n.id);
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              opacity={dim ? 0.25 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${n.label}: ${(n.share * 100).toFixed(1)}% of postings, ${n.degree} strong links`}
              className="cursor-pointer focus:outline-none"
            >
              {variant === "hero" && <circle r={n.r * 2.2} fill={`url(#glow-${variant})`} />}
              <circle r={n.r} fill={seqColor(0.25 + 0.75 * Math.sqrt(n.share / layout.maxShare))} stroke={n.id === hover ? "#e8edf5" : "#0a1628"} strokeWidth={2} />
              {showLabel && (
                <text y={-n.r - 6} textAnchor="middle" fontSize={n.r > 14 ? 14 : 12} fontWeight={n.r > 14 ? 600 : 500} fill="#e8edf5" style={{ paintOrder: "stroke", stroke: "#0a1628", strokeWidth: 4 }}>
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute top-3 right-3">
          <TipBox
            title={hovered.label}
            rows={[
              { label: "Share of postings", value: `${(hovered.share * 100).toFixed(1)}%` },
              { label: "Strong links shown", value: String(hovered.degree) },
              ...layout.simLinks
                .filter((l) => (l.source as SimNode).id === hovered.id || (l.target as SimNode).id === hovered.id)
                .sort((a, b) => b.lift - a.lift)
                .slice(0, 4)
                .map((l) => {
                  const other = (l.source as SimNode).id === hovered.id ? (l.target as SimNode) : (l.source as SimNode);
                  return { label: `with ${other.label}`, value: `lift ${l.lift.toFixed(1)}` };
                }),
            ]}
          />
        </div>
      )}
    </div>
  );
}
