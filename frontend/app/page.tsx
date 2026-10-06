import type { Metadata } from "next";

import { LearnView } from "@/components/learn/LearnView";
import { ApiError, fetchMetaOnServer } from "@/lib/api";
import type { Meta } from "@/types/api";

export const metadata: Metadata = { title: "Learn" };

/** Reads live backend data on every request: never statically prerendered. */
export const dynamic = "force-dynamic";

/**
 * Server component: question metadata (E2) is fetched on the server so the
 * first paint already contains the real questions. A backend outage degrades
 * to an explanatory panel instead of an empty page.
 */
export default async function LearnPage() {
  let meta: Meta | null = null;
  let loadError: string | null = null;

  try {
    meta = await fetchMetaOnServer();
  } catch (cause) {
    loadError =
      cause instanceof ApiError
        ? cause.message
        : "Unexpected error while loading question metadata.";
  }

  return <LearnView meta={meta} loadError={loadError} />;
}
