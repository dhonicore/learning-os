"use client";

import { useTheme } from "@/lib/theme";
import { THEME_MODE_LABELS, THEME_MODES } from "@/lib/tokens";
import { cn } from "@/lib/cn";

const ICONS: Record<string, React.ReactNode> = {
  system: (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  light: (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  dark: (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
};

/**
 * Compact Light/Dark/System switch for the header. On small screens it shows
 * icons only; on larger screens it shows labels.
 */
export function ThemeControl() {
  const { mode, resolved, setMode, ready } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-ctl border border-line bg-surface p-0.5"
    >
      {THEME_MODES.map((option) => {
        const active = ready && mode === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            title={THEME_MODE_LABELS[option]}
            onClick={() => setMode(option)}
            className={cn(
              "rounded-[0.375rem] px-2 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-accent text-on-accent" : "text-muted hover:text-ink",
            )}
          >
            <span className="hidden sm:inline">{THEME_MODE_LABELS[option]}</span>
            <span className="sm:hidden" aria-hidden="true">{ICONS[option]}</span>
            <span className="sr-only">
              {THEME_MODE_LABELS[option]}
              {active ? (resolved === "dark" ? " dark theme active" : " light theme active") : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
