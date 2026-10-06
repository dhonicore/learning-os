"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, fetchHealth } from "@/lib/api";
import type { Health } from "@/types/api";

export type HealthState = {
  status: "checking" | "online" | "offline";
  health: Health | null;
  error: string | null;
  refresh: () => void;
};

const DOT_CLASSES: Record<HealthState["status"], string> = {
  checking: "bg-muted",
  online: "bg-success",
  offline: "bg-error",
};

const DOT_LABEL: Record<HealthState["status"], string> = {
  checking: "Checking API",
  online: "API online",
  offline: "API unreachable",
};

/**
 * Live E1 health probe. Exposed as a hook so the sidebar dot and the Settings
 * diagnostics panel share one implementation and one request.
 */
export function useHealth(): HealthState {
  const [state, setState] = useState<Omit<HealthState, "refresh">>({
    status: "checking",
    health: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setState({ status: "checking", health: null, error: null });
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetchHealth(controller.signal)
      .then((health) => setState({ status: "online", health, error: null }))
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 0 && controller.signal.aborted) {
          return;
        }
        setState({
          status: "offline",
          health: null,
          error: cause instanceof Error ? cause.message : "Unknown error.",
        });
      });

    return () => controller.abort();
  }, [nonce]);

  return { ...state, refresh };
}

/** Tiny status indicator for the shell header. */
export function HealthDot() {
  const { status } = useHealth();

  return (
    <span
      className="hidden items-center gap-2 rounded-ctl border border-line bg-surface px-2.5 py-1.5 text-xs text-muted sm:inline-flex"
      role="status"
      aria-live="polite"
    >
      <span className={`size-1.5 rounded-full ${DOT_CLASSES[status]}`} aria-hidden="true" />
      {DOT_LABEL[status]}
    </span>
  );
}

/** Full diagnostics panel for the Settings page. */
export function HealthPanel() {
  const { status, health, error, refresh } = useHealth();

  return (
    <section className="flex flex-col gap-4" aria-labelledby="api-status-heading">
      <div className="flex items-center justify-between gap-4">
        <h3 id="api-status-heading" className="text-sm font-semibold">
          API status
        </h3>
        <button
          type="button"
          onClick={refresh}
          className="btn btn-ghost btn-xs rounded-ctl text-muted hover:text-ink"
        >
          Re-check
        </button>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${DOT_CLASSES[status]}`} aria-hidden="true" />
          <span className={status === "offline" ? "text-error" : "text-ink"}>
            {DOT_LABEL[status]}
          </span>
        </div>

        {health ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted">
            <dt className="font-mono text-xs">status</dt>
            <dd className="font-mono text-xs text-ink">{health.status}</dd>
            <dt className="font-mono text-xs">DATABASE_URL</dt>
            <dd className="font-mono text-xs text-ink">
              {health.db_configured ? "configured" : "missing"}
            </dd>
            <dt className="font-mono text-xs">GROQ_API_KEY</dt>
            <dd className="font-mono text-xs text-ink">
              {health.llm_configured ? "configured" : "missing"}
            </dd>
          </dl>
        ) : null}

        {status === "offline" && error ? (
          <p className="text-error">
            {error} Start the backend with{" "}
            <code className="font-mono text-xs">uvicorn app_main:app --port 8000</code> and retry.
          </p>
        ) : null}

        {status === "checking" ? (
          <p className="text-muted">Contacting the FastAPI health endpoint…</p>
        ) : null}
      </div>
    </section>
  );
}