import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DARK, LIGHT, PALETTES, isThemeMode, isThemeName, resolveTheme } from "@/lib/tokens";

const APP_PY = join(__dirname, "..", "..", "app.py");

type PaletteKey = keyof typeof LIGHT;

const PALETTE_MAP: Record<PaletteKey, string> = {
  canvas: "bg",
  surface: "surface",
  ink: "text",
  muted: "text-2",
  line: "border",
  accent: "accent",
  onAccent: "on-accent",
  success: "success",
  error: "error",
  warning: "warning",
};

/**
 * The Streamlit app remains the source of truth for the palette. This reads
 * its LIGHT/DARK dicts straight from source and fails if the frontend tokens
 * drift, so the two frontends can never quietly diverge.
 */
function readAppPalette(): Record<"LIGHT" | "DARK", Record<string, string>> {
  const source = readFileSync(APP_PY, "utf8");
  const readBlock = (name: "LIGHT" | "DARK") => {
    const match = new RegExp(`${name} = \\{([\\s\\S]*?)\\n\\}`).exec(source);
    if (!match) throw new Error(`${name} dict not found in app.py`);
    const entries = [...match[1].matchAll(/"([a-z0-9-]+)":\s*"(#[0-9A-Fa-f]{6})"/g)];
    return Object.fromEntries(entries.map((entry) => [entry[1], entry[2].toUpperCase()]));
  };
  return { LIGHT: readBlock("LIGHT"), DARK: readBlock("DARK") };
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

describe("token parity with app.py", () => {
  const appPalette = readAppPalette();

  for (const theme of ["LIGHT", "DARK"] as const) {
    it(`${theme} palette matches the Streamlit source of truth`, () => {
      const tokens = theme === "LIGHT" ? LIGHT : DARK;
      for (const token of Object.keys(PALETTE_MAP) as PaletteKey[]) {
        const appKey = PALETTE_MAP[token];
        expect(tokens[token], `${theme}.${token} <- app.py ${theme}.${appKey}`).toBe(
          appPalette[theme][appKey],
        );
      }
    });
  }
});

describe("accessibility of the carried-over palette", () => {
  it("primary text meets WCAG AA on canvas and surface in both themes", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.ink, palette.canvas), `${name} ink/canvas`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.ink, palette.surface), `${name} ink/surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("secondary text meets WCAG AA on canvas and surface in both themes", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(contrastRatio(palette.muted, palette.canvas), `${name} muted/canvas`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.muted, palette.surface), `${name} muted/surface`).toBeGreaterThanOrEqual(4.5);
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