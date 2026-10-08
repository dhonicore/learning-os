"use client";

import { isThemeMode, resolveTheme, type ThemeMode, type ThemeName } from "@/lib/tokens";

/**
 * Theme state lives outside React, because it is genuinely external state:
 * the URL (`?theme=`) and the OS preference both outlive any component.
 * Modelling it as a store lets components read it through
 * `useSyncExternalStore`, which is hydration-safe and never needs an effect
 * that calls `setState`.
 */

export type ThemeState = {
  mode: ThemeMode;
  resolved: ThemeName;
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

const SERVER_STATE: ThemeState = { mode: "system", resolved: "light" };

const listeners = new Set<() => void>();
let state: ThemeState = SERVER_STATE;
let media: MediaQueryList | null = null;
let attached = false;

function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

function paint(resolved: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = resolved === "dark" ? "learning-dark" : "learning-light";
  root.style.colorScheme = resolved;
}

function readModeFromLocation(): ThemeMode {
  const fromQuery = new URLSearchParams(window.location.search).get("theme");
  return isThemeMode(fromQuery) ? fromQuery : "system";
}

function resolve(mode: ThemeMode): ThemeName {
  return resolveTheme(mode, media ? media.matches : prefersDark());
}

function onSystemChange(): void {
  state = { mode: state.mode, resolved: resolve(state.mode) };
  paint(state.resolved);
  for (const listener of listeners) listener();
}

/** Adopt the URL choice when the app mounts (0 → 1 subscribers). */
function initialize(): void {
  if (typeof window === "undefined") return;
  if (!media) {
    media = window.matchMedia(DARK_QUERY);
  }
  const mode = readModeFromLocation();
  state = { mode, resolved: resolve(mode) };
  paint(state.resolved);
}

export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    initialize();
    if (media && !attached) {
      media.addEventListener("change", onSystemChange);
      attached = true;
    }
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && media && attached) {
      media.removeEventListener("change", onSystemChange);
      attached = false;
    }
  };
}

export function getSnapshot(): ThemeState {
  return state;
}

export function getServerSnapshot(): ThemeState {
  return SERVER_STATE;
}

export function setMode(next: ThemeMode): void {
  if (typeof window === "undefined") return;
  if (next === state.mode) return;
  state = { mode: next, resolved: resolve(next) };
  paint(state.resolved);

  const url = new URL(window.location.href);
  if (next === "system") {
    url.searchParams.delete("theme");
  } else {
    url.searchParams.set("theme", next);
  }
  window.history.replaceState(null, "", url.toString());

  for (const listener of listeners) listener();
}

export function toggleMode(): void {
  setMode(state.resolved === "dark" ? "light" : "dark");
}