import type { Health, Meta } from "@/types/api";

/**
 * Backend origin for the Next.js dev server proxy. In production the API is
 * served from the same origin as the frontend, so no rewrite target is needed.
 */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error && cause.name === "AbortError"
        ? "Request cancelled."
        : `Cannot reach the API at ${API_ORIGIN}.`,
      0,
    );
  }
  if (!response.ok) {
    throw new ApiError(`API request failed with status ${response.status}.`, response.status);
  }
  return (await response.json()) as T;
}

/** E1 — liveness plus which secrets are configured (never their values). */
export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return getJson<Health>("/api/health", signal);
}

/** E2 — question metadata. Never includes `reference_sql`. */
export function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return getJson<Meta>("/api/meta", signal);
}

/** E4 — database schema (tables + foreign keys). */
export function fetchSchema(signal?: AbortSignal): Promise<{ tables: Array<Array<string | string[]>>; foreign_keys: Array<[string, string]> }> {
  return getJson<{ tables: Array<Array<string | string[]>>; foreign_keys: Array<[string, string]> }>("/api/schema", signal);
}

/**
 * Server-side variant used by App Router server components.
 * Always uses the full backend URL since the Next.js proxy only works for browser requests.
 */
export async function fetchMetaOnServer(): Promise<Meta> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    response = await fetch(`${API_ORIGIN}/api/meta`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new ApiError(`API request timed out after 10s.`, 0);
    }
    throw new ApiError(`Cannot reach the API at ${API_ORIGIN}.`, 0);
  }
  if (!response.ok) {
    throw new ApiError(`API request failed with status ${response.status}.`, response.status);
  }
  return (await response.json()) as Meta;
}