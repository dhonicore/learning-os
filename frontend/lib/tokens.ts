/**
 * Design tokens — mirrored from the validated Streamlit palette.
 *
 * Source of truth: `app.py` (`LIGHT` / `DARK` dicts), which was verified in
 * Stage E/F: WCAG AA text contrast in both themes and accent focus rings at
 * 6.9:1 (light) / 8.8:1 (dark). `tests/tokens.test.ts` fails if these values
 * ever drift from `app.py`, so the two frontends cannot diverge.
 *
 * The CSS custom properties in `app/globals.css` repeat these values; this
 * module is the typed copy used by components that need a raw hex (Monaco
 * theme, canvas rendering) and by the drift test.
 */

export type ThemeName = "light" | "dark";
export type ThemeMode = ThemeName | "system";

export type Palette = {
  /** Page background. */
  canvas: string;
  /** Raised surfaces: cards, panels. */
  surface: string;
  /** Primary text. */
  ink: string;
  /** Secondary text: captions, labels. */
  muted: string;
  /** Hairline borders and dividers. */
  line: string;
  /** Forest green: primary actions, active state, focus rings. */
  accent: string;
  /** Text/icon colour on top of `accent`. */
  onAccent: string;
  success: string;
  error: string;
  warning: string;
};

export const LIGHT: Palette = {
  canvas: "#F4F3EE",
  surface: "#FFFFFF",
  ink: "#202722",
  muted: "#657067",
  line: "#E5E6DF",
  accent: "#285D3D",
  onAccent: "#FFFFFF",
  success: "#1B6E40",
  error: "#A93226",
  warning: "#7A5B12",
};

export const DARK: Palette = {
  canvas: "#191E1B",
  surface: "#242B26",
  ink: "#F0F1EA",
  muted: "#A8B2A9",
  line: "#3C453E",
  accent: "#9CC5A4",
  onAccent: "#191E1B",
  success: "#8CC7A2",
  error: "#E8A199",
  warning: "#D9BC76",
};

export const PALETTES: Record<ThemeName, Palette> = { light: LIGHT, dark: DARK };

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"] as const;

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export const THEME_MODE_DESCRIPTIONS: Record<ThemeMode, string> = {
  system: "Follows your device's light or dark setting.",
  light: "Warm off-white background with dark text.",
  dark: "Deep charcoal background with light text.",
};

export const THEME_STORAGE_KEY = "learning-os-theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === "light" || value === "dark";
}

/** Resolve a mode to a concrete theme, given the OS preference. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ThemeName {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}