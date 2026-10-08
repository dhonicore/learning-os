import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeControl } from "@/components/system/ThemeControl";
import { ThemeProvider } from "@/lib/theme";

function renderThemeControl() {
  return render(
    <ThemeProvider>
      <ThemeControl />
    </ThemeProvider>,
  );
}

describe("ThemeControl", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("color-scheme");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to following the device and paints the light theme on a light device", async () => {
    renderThemeControl();

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("learning-light");
    });
    expect(screen.getByRole("radio", { name: /System/ })).toHaveAttribute("aria-checked", "true");
  });

  it("writes the choice to the URL and applies the dark theme", async () => {
    const user = userEvent.setup();
    renderThemeControl();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("learning-light"));

    await user.click(screen.getByRole("radio", { name: /Dark/ }));

    expect(document.documentElement.dataset.theme).toBe("learning-dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(new URLSearchParams(window.location.search).get("theme")).toBe("dark");
  });

  it("returns to following the device and drops the query parameter", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?theme=dark");
    renderThemeControl();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("learning-dark"));

    await user.click(screen.getByRole("radio", { name: /System/ }));

    expect(document.documentElement.dataset.theme).toBe("learning-light");
    expect(new URLSearchParams(window.location.search).has("theme")).toBe(false);
  });

  it("honours ?theme= on first load", async () => {
    window.history.replaceState(null, "", "/?theme=light");
    renderThemeControl();
    await waitFor(() => expect(screen.getByRole("radio", { name: /Light/ })).toHaveAttribute("aria-checked", "true"));
  });

  it("ignores an unsupported ?theme= value and follows the device", async () => {
    window.history.replaceState(null, "", "/?theme=neon");
    renderThemeControl();
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /System/ })).toHaveAttribute("aria-checked", "true");
    });
  });
});