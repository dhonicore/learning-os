"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import {
  getServerSnapshot,
  getSnapshot,
  setMode as setStoreMode,
  subscribe,
  toggleMode,
  type ThemeState,
} from "@/lib/theme-store";
import type { ThemeMode } from "@/lib/tokens";

type ThemeContextValue = ThemeState & {
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  /** False during server rendering and the first client paint. */
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Hydration flag without an effect: `true` only after the client takes over. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Applies Light/Dark/System to `<html data-theme>` and keeps the choice in the
 * URL (`?theme=dark`), exactly like the Streamlit app. No cookie and no
 * storage: a refresh with no query parameter returns to following the device.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useHydrated();

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...state,
      setMode: setStoreMode,
      toggle: toggleMode,
      ready,
    }),
    [state, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }
  return context;
}