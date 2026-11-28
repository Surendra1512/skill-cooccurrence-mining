"use client";

import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Download, Info, Loader2 } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        <h1 className="text-[1.9rem] leading-tight font-semibold tracking-[-0.015em] text-fg md:text-[2.25rem]">{title}</h1>
        <p className="mt-2 text-[0.98rem] leading-relaxed text-muted">{lead}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Section({ title, description, actions, children, className }: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("mt-10", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-3xl">
            {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className, tone = "default" }: { children: ReactNode; className?: string; tone?: "default" | "raised" | "flat" }) {
  return (
    <div
      className={cx(
        "rounded-2xl border",
        tone === "raised" && "border-line-2 bg-panel-2 p-5",
        tone === "default" && "border-line bg-panel p-5",
        tone === "flat" && "border-line bg-transparent p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface Stat {
  label: string;
  value: string;
  hint?: string;
}

/** Headline numbers separated by hairlines rather than boxed individually. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-panel sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
      {stats.map((s) => (
        <div key={s.label} className="border-line px-5 py-4 [&:not(:last-child)]:border-r max-lg:border-b" title={s.hint}>
          <dt className="text-[0.8rem] text-muted">{s.label}</dt>
          <dd className="mt-1 text-[1.45rem] font-semibold tracking-tight whitespace-nowrap text-fg">{s.value}</dd>
          {s.hint && <p className="mt-0.5 text-xs leading-snug text-faint">{s.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled,
  icon,
  className,
  ariaLabel,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-signal text-white hover:bg-[#2a7ad4]",
        variant === "secondary" && "border border-line-2 bg-panel-2 text-fg hover:border-signal/60",
        variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-fg",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function DownloadButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button onClick={onClick} disabled={disabled} icon={<Download size={15} aria-hidden />}>
      {children}
    </Button>
  );
}

export function Segmented<T extends string | number>({ label, options, value, onChange, format }: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-ink-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cx(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            o === value ? "bg-panel-2 text-fg shadow-[inset_0_0_0_1px_var(--color-line-2)]" : "text-muted hover:text-fg",
          )}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Sections" className="mt-8 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`panel-${t.id}`}
          tabIndex={t.id === active ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === active);
            if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id);
            if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
          }}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors",
            t.id === active ? "border-signal text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="pt-2">
      {children}
    </div>
  );
}

export function SliderField({ label, value, min, max, step, onChange, format, hint }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-fg">
          {label}
        </label>
        <output htmlFor={id} className="text-sm font-medium text-signal-soft">
          {format ? format(value) : value}
        </output>
      </div>
      <input id={id} type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="mt-1.5 text-xs leading-snug text-faint">{hint}</p>}
    </div>
  );
}

export function SelectField<T extends string | number>({ label, value, options, onChange, hideLabel }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={cx("text-sm text-muted", hideLabel && "sr-only")}>
        {label}
      </label>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const found = options.find((o) => String(o.value) === e.target.value);
          if (found) onChange(found.value);
        }}
        className="rounded-lg border border-line-2 bg-ink-2 px-3 py-2 text-sm text-fg"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "note"}
      className={cx(
        "flex gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed",
        tone === "info" ? "border-signal/30 bg-signal/[0.07] text-fg" : "border-warn/35 bg-warn/[0.07] text-fg",
      )}
    >
      {tone === "info" ? <Info size={18} className="mt-0.5 shrink-0 text-signal-soft" aria-hidden /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-sm text-muted">
      <Loader2 size={18} className="animate-spin text-signal" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line-2 px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

/** Collapsible accessible table view under a chart. */
export function DataToggle({ children, label = "Show data table" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm text-signal-soft hover:underline">
        {open ? "Hide data table" : label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "signal" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "border-line-2 text-muted",
        tone === "good" && "border-good/40 text-[#3fd25a]",
        tone === "bad" && "border-bad/40 text-bad",
        tone === "signal" && "border-signal/40 text-signal-soft",
      )}
    >
      {children}
    </span>
  );
}
