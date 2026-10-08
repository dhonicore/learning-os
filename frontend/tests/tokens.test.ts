import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DARK, LIGHT, PALETTES, isThemeMode, isThemeName, resolveTheme } from "@/lib/tokens";

const GLOBALS_CSS = join(__dirname, "..", "app", "globals.css");

/**
 * The CSS file in `app/globals.css` is the single source of truth for the
 * visual identity. This test reads the custom property values directly from
 * that file and fails if `lib/tokens.ts` drifts, so components that need raw
 * hex values (Monaco theme, canvas rendering) stay in sync with the CSS.
 */

const TOKEN_TO_CSS: Record<keyof typeof LIGHT, string> = {
  canvas: "--canvas",
  surface: "--surface",
  raised: "--raised",
  code: "--code",
  ink: "--ink",
  muted: "--muted",
  line: "--line",
  lineStrong: "--line-strong",
  accent: "--accent",
  accentHover: "--accent-hover",
  onAccent: "--on-accent",
  success: "--success",
  warning: "--warning",
  error: "--error",
};

function readCss(): string {
  return readFileSync(GLOBALS_CSS, "utf8");
}

function extractBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (!match) throw new Error(`Could not find ${selector} block in globals.css`);
  return match[1];
}

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /(--[a-z0-9\-]+):\s*(#[0-9A-Fa-f]{6})/.exec(line);
    if (match) vars[match[1]] = match[2].toUpperCase();
  }
  return vars;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)!
    .map((channel) => parseInt(channel, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

describe("token parity with CSS source of truth", () => {
  const css = readCss();
  const lightVars = parseVars(extractBlock(css, ":root"));
  const darkVars = parseVars(extractBlock(css, '[data-theme="learning-dark"]'));

  for (const [themeName, tokens, vars] of [
    ["LIGHT", LIGHT, lightVars],
    ["DARK", DARK, darkVars],
  ] as const) {
    it(`${themeName} palette matches app/globals.css`, () => {
      for (const token of Object.keys(TOKEN_TO_CSS) as Array<keyof typeof LIGHT>) {
        const cssVar = TOKEN_TO_CSS[token];
        const cssValue = vars[cssVar];
        expect(cssValue, `${themeName}.${token} is defined in CSS`).toBeDefined();
        expect(tokens[token], `${themeName}.${token} matches ${cssVar}`).toBe(cssValue);
      }
    });
  }
});

describe("accessibility of the Learning OS palette", () => {
  it("primary text meets WCAG AA on canvas, surface, and code in both themes", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const bg of ["canvas", "surface", "code"] as const) {
        expect(contrastRatio(palette.ink, palette[bg]), `${name} ink/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("secondary text meets WCAG AA on canvas, surface, and code in both themes", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const bg of ["canvas", "surface", "code"] as const) {
        expect(contrastRatio(palette.muted, palette[bg]), `${name} muted/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("accent is readable on surface and on-accent text is readable on accent", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.accent, palette.surface), `${name} accent/surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.onAccent, palette.accent), `${name} on-accent/accent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("semantic colours meet WCAG AA on surface in both themes", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.success, palette.surface), `${name} success`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.error, palette.surface), `${name} error`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.warning, palette.surface), `${name} warning`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("control boundaries meet WCAG 1.4.11 non-text contrast on surface and canvas", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.lineStrong, palette.surface), `${name} line-strong/surface`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.lineStrong, palette.canvas), `${name} line-strong/canvas`).toBeGreaterThanOrEqual(3);
    }
  });

  it("focus ring meets WCAG non-text contrast on canvas", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.accent, palette.canvas), `${name} accent/canvas`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("theme resolution", () => {
  it("system follows the device preference", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("explicit modes ignore the device preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("validates untrusted input", () => {
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("neon")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeName("dark")).toBe(true);
    expect(isThemeName("system")).toBe(false);
  });
});
