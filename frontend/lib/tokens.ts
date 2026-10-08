/**
 * Design tokens — typed mirror of the CSS custom properties in
 * `app/globals.css`.
 *
 * The CSS file is the source of truth for the visual identity. This module
 * exports the same hex values so components that need raw colours (Monaco
 * theme, canvas rendering) can import them without parsing CSS at runtime.
 *
 * `tests/tokens.test.ts` verifies that these values stay in sync with the
 * CSS source of truth and that every text/border pair meets WCAG AA.
 */

export type ThemeName = "light" | "dark";
export type ThemeMode = ThemeName | "system";

export type Palette = {
  /** Page background. */
  canvas: string;
  /** Raised surfaces: cards, panels. */
  surface: string;
  /** Slightly elevated surface. */
  raised: string;
  /** Code editor background. */
  code: string;
  /** Primary text. */
  ink: string;
  /** Secondary text: captions, labels. Meets WCAG AA on all surfaces. */
  muted: string;
  /** Hairline borders and dividers. */
  line: string;
  /** Stronger borders for interactive control boundaries. */
  lineStrong: string;
  /** Primary interaction colour: actions, focus, active states. */
  accent: string;
  /** Hover/pressed state for primary interactions. */
  accentHover: string;
  /** Text/icon colour on top of `accent`. */
  onAccent: string;
  success: string;
  error: string;
  warning: string;
};

export const LIGHT: Palette = {
  canvas: "#F7F7F5",
  surface: "#FFFFFF",
  raised: "#FAFAF9",
  code: "#F2F3F5",
  ink: "#16181D",
  muted: "#5F636D",
  line: "#DCDDE1",
  lineStrong: "#8F8F8F",
  accent: "#315EF5",
  accentHover: "#2448C7",
  onAccent: "#FFFFFF",
  success: "#1B6E40",
  error: "#A93226",
  warning: "#7A5B12",
};

export const DARK: Palette = {
  canvas: "#0D0F12",
  surface: "#14171C",
  raised: "#1A1E24",
  code: "#101318",
  ink: "#F2F4F7",
  muted: "#A7ADB8",
  line: "#292E36",
  lineStrong: "#646464",
  accent: "#6D8CFF",
  accentHover: "#5475F5",
  onAccent: "#0D0F12",
  success: "#8CC7A2",
  error: "#E8A199",
  warning: "#D9BC76",
};

export const PALETTES: Record<ThemeName, Palette> = { light: LIGHT, dark: DARK };

// Augmented palette including generated colour-mix surfaces.
type MixedPalette = Palette & {
  accentSoft: string;
  accentSubtle: string;
};

/** Returns the full palette including generated colour-mix surfaces. */
export function fullPalette(theme: ThemeName): MixedPalette {
  const base = PALETTES[theme];
  return {
    ...base,
    accentSoft: mix(base.accent, base.surface, 0.1),
    accentSubtle: mix(base.accent, base.surface, 0.06),
  };
}

/** Monaco editor chrome colours derived from the current palette. */
export function monacoColors(palette: MixedPalette): Record<string, string> {
  return {
    "editor.background": palette.code,
    "editor.foreground": palette.ink,
    "editorLineNumber.foreground": palette.muted,
    "editorLineNumber.activeForeground": palette.ink,
    "editorCursor.foreground": palette.accent,
    "editor.selectionBackground": palette.accentSubtle,
    "editor.inactiveSelectionBackground": palette.accentSubtle,
    "editor.lineHighlightBackground": palette.raised,
    "editorWidget.background": palette.surface,
    "editorWidget.border": palette.line,
    "input.background": palette.surface,
    "input.border": palette.lineStrong,
    "input.foreground": palette.ink,
    "list.activeSelectionBackground": palette.accentSoft,
    "list.hoverBackground": palette.raised,
    "scrollbarSlider.background": palette.lineStrong,
    "scrollbarSlider.hoverBackground": palette.muted,
    "scrollbarSlider.activeBackground": palette.accent,
  };
}

function mix(a: string, b: string, shareB: number): string {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  return `#${[0, 1, 2]
    .map((i) => Math.round(rgbA[i] * (1 - shareB) + rgbB[i] * shareB))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"] as const;

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export const THEME_MODE_DESCRIPTIONS: Record<ThemeMode, string> = {
  system: "Follows your device's light or dark setting.",
  light: "Off-white background with dark text.",
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
