"use client";

import { useTheme } from "@/lib/theme";
import { THEME_MODE_LABELS, THEME_MODES } from "@/lib/tokens";
import { cn } from "@/lib/cn";

/**
 * Compact Light/Dark/System switch for the header. The full explanation with
 * descriptions lives on the Settings page; here it is a single control that
 * also toggles between light and dark when clicked as a whole.
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
              "rounded-[0.375rem] px-2.5 py-1 text-xs font-medium transition-colors",
              active ? "bg-accent text-on-accent" : "text-muted hover:text-ink",
            )}
          >
            <span className="hidden sm:inline">{THEME_MODE_LABELS[option]}</span>
            <span className="sm:hidden">{THEME_MODE_LABELS[option].slice(0, 1)}</span>
            <span className="sr-only">
              {resolved === "dark" ? " (dark theme active)" : " (light theme active)"}
            </span>
          </button>
        );
      })}
    </div>
  );
}