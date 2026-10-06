import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthPanel } from "@/components/system/HealthPanel";

function mockHealthOnce(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: async () => payload,
  });
}

describe("HealthPanel (E1 connectivity check)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the API as online with the configured secret flags", async () => {
    vi.stubGlobal(
      "fetch",
      mockHealthOnce({ status: "ok", db_configured: true, llm_configured: true }),
    );
    render(<HealthPanel />);

    await waitFor(() => expect(screen.getByText("API online")).toBeInTheDocument());
    expect(screen.getAllByText("configured")).toHaveLength(2);
  });

  it("reports a missing secret honestly instead of claiming a healthy stack", async () => {
    vi.stubGlobal(
      "fetch",
      mockHealthOnce({ status: "ok", db_configured: false, llm_configured: true }),
    );
    render(<HealthPanel />);

    await waitFor(() => expect(screen.getByText("API online")).toBeInTheDocument());
    expect(screen.getByText("missing")).toBeInTheDocument();
  });

  it("shows an actionable message when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    render(<HealthPanel />);

    await waitFor(() => expect(screen.getByText("API unreachable")).toBeInTheDocument());
    expect(screen.getByText(/uvicorn app_main:app/)).toBeInTheDocument();
  });

  it("re-checks on demand", async () => {
    const user = userEvent.setup();
    const fetchMock = mockHealthOnce({ status: "ok", db_configured: true, llm_configured: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<HealthPanel />);
    await waitFor(() => expect(screen.getByText("API online")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Re-check" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("treats a non-200 response as unreachable", async () => {
    vi.stubGlobal("fetch", mockHealthOnce({}, false));
    render(<HealthPanel />);
    await waitFor(() => expect(screen.getByText("API unreachable")).toBeInTheDocument());
  });
});
