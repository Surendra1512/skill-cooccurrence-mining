"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cx } from "./ui";

export interface Option {
  value: number;
  label: string;
  hint?: string;
}

/**
 * Accessible searchable multi-select (combobox + listbox).
 * Keyboard: type to filter, ↑/↓ to move, Enter to toggle, Esc to close,
 * Backspace on empty input removes the last selection.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Search…",
  max,
  hideLabel,
  allLabel,
}: {
  label: string;
  options: Option[];
  value: number[];
  onChange: (v: number[]) => void;
  placeholder?: string;
  max?: number;
  hideLabel?: boolean;
  allLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return list.slice(0, 200);
  }, [options, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (v: number) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (!max || value.length < max) onChange([...value, v]);
    setQuery("");
    setActive(0);
  };

  const atMax = !!max && value.length >= max;

  return (
    <div ref={root} className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className={cx("text-sm text-muted", hideLabel && "sr-only")}>
        {label}
      </label>
      <div
        className="flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 focus-within:border-signal/70"
        onClick={() => {
          input.current?.focus();
          setOpen(true);
        }}
      >
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-panel-2 py-0.5 pr-1 pl-2 text-xs text-fg ring-1 ring-line-2">
            {byValue.get(v)?.label ?? v}
            <button
              type="button"
              aria-label={`Remove ${byValue.get(v)?.label ?? v}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(v);
              }}
              className="rounded p-0.5 text-muted hover:text-fg"
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${id}-opt-${filtered[active].value}` : undefined}
          value={query}
          placeholder={value.length === 0 ? (allLabel ?? placeholder) : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && filtered[active]) toggle(filtered[active].value);
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Backspace" && query === "" && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          className="min-w-[8ch] flex-1 bg-transparent px-1 py-0.5 text-sm text-fg placeholder:text-faint focus:outline-none"
        />
        {value.length > 0 ? (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            className="rounded p-1 text-muted hover:text-fg"
          >
            <X size={14} aria-hidden />
          </button>
        ) : (
          <ChevronDown size={15} className="mr-1 text-faint" aria-hidden />
        )}
      </div>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute top-full z-40 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-xl border border-line-2 bg-panel-2 p-1 shadow-2xl shadow-black/40"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">No match for “{query}”.</li>}
          {filtered.map((o, i) => {
            const selected = value.includes(o.value);
            return (
              <li
                key={o.value}
                id={`${id}-opt-${o.value}`}
                role="option"
                aria-selected={selected}
                aria-disabled={!selected && atMax}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle(o.value)}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm",
                  i === active ? "bg-ink-2 text-fg" : "text-fg/90",
                  !selected && atMax && "cursor-not-allowed opacity-40",
                )}
              >
                <span className={cx("grid size-4 place-items-center rounded border", selected ? "border-signal bg-signal" : "border-line-2")}>
                  {selected && <Check size={12} className="text-white" aria-hidden />}
                </span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-xs text-faint">{o.hint}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {max && <p className="text-xs text-faint">{value.length} of {max} selected</p>}
    </div>
  );
}
