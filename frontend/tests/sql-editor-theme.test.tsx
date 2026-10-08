import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SqlEditor } from "@/components/learn/SqlEditor";
import { ThemeProvider } from "@/lib/theme";

// The real loader fetches Monaco from a CDN and the real `monaco-editor`
// package cannot load under jsdom. Both are irrelevant here: this suite pins
// the theme *mapping* (resolved app theme -> Monaco theme prop), so the
// editor is replaced with a stub that records the `theme` it receives.
vi.mock("@monaco-editor/react", () => ({
  default: ({ theme }: { theme?: string }) => (
    <div data-testid="monaco-mock" data-monaco-theme={theme ?? ""} />
  ),
}));

// Imported by SqlEditor for types only (`monaco.editor.*` in signatures).
vi.mock("monaco-editor", () => ({}));

// Mutable singleton for the device colour-scheme preference. The theme store
// caches the first MediaQueryList object it sees for the session, so the
// preference is flipped by mutating `matches` — replacing `window.matchMedia`
// between tests would be silently ignored after the first render.
const devicePreference = {
  matches: false,
  media: "(prefers-color-scheme: dark)",
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
};

function renderEditor(url: string, darkDevice: boolean): string | null {
  devicePreference.matches = darkDevice;
  window.history.replaceState(null, "", url);
  render(
    <ThemeProvider>
      <SqlEditor value="" onChange={() => {}} />
    </ThemeProvider>,
  );
  return screen.getByTestId("monaco-mock").getAttribute("data-monaco-theme");
}

describe("SqlEditor theme mapping (Slice C)", () => {
  beforeEach(() => {
    window.matchMedia = (() =>
      devicePreference) as unknown as typeof window.matchMedia;
    document.documentElement.removeAttribute("data-theme");
  });

  it("uses the light Monaco theme when the app resolves light", () => {
    expect(renderEditor("/", false)).toBe("light");
  });

  it("uses vs-dark when explicit dark is chosen", () => {
    expect(renderEditor("/?theme=dark", false)).toBe("vs-dark");
  });

  it("uses the light Monaco theme when explicit light overrides a dark device", () => {
    expect(renderEditor("/?theme=light", true)).toBe("light");
  });

  it("uses vs-dark in System mode on a dark device (mode vs resolved regression)", () => {
    // Default mode is System; a dark device resolves dark. Keying Monaco off
    // `mode` rendered a white editor here — the Slice C bug.
    expect(renderEditor("/", true)).toBe("vs-dark");
  });
});
