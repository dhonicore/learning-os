import type { NextConfig } from "next";

/**
 * The FastAPI backend runs as a separate process (Phase 1: port 8000). The
 * frontend proxies `/api/*` to it so the browser only ever talks to one
 * origin — no CORS configuration, and the same code path works in dev and in
 * a single-origin deployment.
 */
const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;