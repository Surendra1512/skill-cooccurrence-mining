"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, BookOpen, CalendarRange, GitBranch, GraduationCap, LayoutDashboard, Menu, Network, SlidersHorizontal, X } from "lucide-react";
import { useStore } from "@/lib/client/store";
import { fmtInt, fmtSec } from "@/lib/client/format";
import { TEAM } from "@/lib/project";
import { MiningSettings } from "./MiningSettings";
import { MultiSelect } from "./MultiSelect";
import { Button, cx, Loading, SelectField } from "./ui";

/** Any page can open the mining settings panel by dispatching this event. */
export const OPEN_SETTINGS_EVENT = "open-mining-settings";

export function openMiningSettings(): void {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
}

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/skills", label: "Skill analysis", icon: BarChart3 },
  { href: "/rules", label: "Association rules", icon: GitBranch },
  { href: "/explorer", label: "Combination explorer", icon: Network },
  { href: "/temporal", label: "Temporal analysis", icon: CalendarRange },
  { href: "/planner", label: "Training planner", icon: GraduationCap },
  { href: "/methodology", label: "Data & methodology", icon: BookOpen },
];

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#142641" />
      <g stroke="#338ced" strokeWidth="1.4" strokeOpacity="0.75">
        <line x1="9" y1="21" x2="16" y2="10" />
        <line x1="16" y1="10" x2="23" y2="19" />
        <line x1="9" y1="21" x2="23" y2="19" />
      </g>
      <circle cx="16" cy="10" r="3.2" fill="#84b9f3" />
      <circle cx="9" cy="21" r="2.4" fill="#338ced" />
      <circle cx="23" cy="19" r="2.8" fill="#6aabf1" />
    </svg>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-3 px-5 pt-6 pb-5">
        <Mark />
        <span className="leading-tight">
          <span className="block text-[0.95rem] font-semibold text-fg">Skill Co-Occurrence</span>
          <span className="block text-xs text-muted">SIH26087 mining dashboard</span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex-1 px-3">
        <ul className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-[0.92rem] transition-colors",
                    active ? "bg-panel-2 text-fg shadow-[inset_2px_0_0_var(--color-signal)]" : "text-muted hover:bg-panel hover:text-fg",
                  )}
                >
                  <Icon size={17} aria-hidden className={active ? "text-signal-soft" : ""} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-line px-5 py-5 text-xs leading-relaxed text-muted">
        <p className="text-fg">Team</p>
        <ul className="mt-1">
          {TEAM.members.map((m) => (
            <li key={m.regNo}>
              {m.name} <span className="text-faint">({m.regNo})</span>
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Faculty: <span className="text-fg/90">{TEAM.faculty}</span>
        </p>
        <p className="mt-1 text-faint">{TEAM.university}</p>
      </div>
    </div>
  );
}

function ContextBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { datasets, dataset, setActive, scope, setScope, mining, config } = useStore();
  if (!dataset) return null;
  const roleOptions = dataset.roles.map((r, i) => ({ value: i, label: r }));
  const countryOptions = dataset.countries.map((c, i) => ({ value: i, label: c }));
  const status =
    mining.status === "running"
      ? "Mining…"
      : mining.status === "done" && mining.result
        ? `${config.algorithm}: ${fmtInt(mining.result.ranked.length)} rules in ${fmtSec(mining.result.seconds)}`
        : mining.status === "error"
          ? "Mining failed"
          : "";
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto grid max-w-[1320px] gap-3 px-5 py-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end lg:px-10">
        <SelectField label="Dataset" value={dataset.id} options={datasets.map((d) => ({ value: d.id, label: d.label }))} onChange={setActive} />
        <MultiSelect label="Job roles" options={roleOptions} value={scope.roles} onChange={(roles) => setScope({ ...scope, roles })} allLabel="All roles" />
        <MultiSelect label="Countries" options={countryOptions} value={scope.countries} onChange={(countries) => setScope({ ...scope, countries })} allLabel="All countries" />
        <div className="flex items-center gap-3">
          <span role="status" aria-live="polite" className={cx("hidden text-xs xl:block", mining.status === "error" ? "text-bad" : "text-muted")}>
            {mining.status === "running" && <span className="mr-1.5 inline-block size-2 animate-pulse-soft rounded-full bg-signal align-middle" />}
            {status}
          </span>
          <Button onClick={onOpenSettings} icon={<SlidersHorizontal size={15} aria-hidden />}>
            Mining settings
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status, loadError } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setSettingsOpen(false), setMenuOpen(false));
    const onOpen = () => setSettingsOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
    };
  }, []);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <a href="#main" className="sr-only z-50 rounded bg-signal px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-ink-2 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile header + drawer */}
      <div className="flex items-center justify-between border-b border-line bg-ink-2 px-4 py-3 lg:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="text-sm font-semibold">Skill Co-Occurrence</span>
        </Link>
        <Button variant="ghost" ariaLabel="Open menu" icon={<Menu size={20} aria-hidden />} onClick={() => setMenuOpen(true)} />
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-line bg-ink-2">
            <Button variant="ghost" ariaLabel="Close menu" icon={<X size={18} aria-hidden />} onClick={() => setMenuOpen(false)} className="absolute top-4 right-3" />
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0">
        {status === "ready" && <ContextBar onOpenSettings={() => setSettingsOpen(true)} />}
        <main id="main" className="mx-auto max-w-[1320px] px-5 pt-8 pb-20 lg:px-10">
          {status === "loading" && <Loading label="Loading 670,261 real job postings…" />}
          {status === "error" && (
            <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-5 text-sm">
              The dataset could not be loaded: {loadError}. Check your connection and reload the page.
            </div>
          )}
          {status === "ready" && children}
        </main>
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSettingsOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-ink-2 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 id="settings-title" className="text-base font-semibold">
                Mining settings
              </h2>
              <Button variant="ghost" ariaLabel="Close settings" icon={<X size={18} aria-hidden />} onClick={() => setSettingsOpen(false)} />
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <MiningSettings onApplied={() => setSettingsOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
