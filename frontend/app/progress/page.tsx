import { fetchMetaOnServer } from "@/lib/api";
import type { Meta } from "@/types/api";
import { ProgressView } from "@/components/learn/ProgressView";
import { ApiError } from "@/lib/api";

/** Reads live backend data on every request: never statically prerendered. */
export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  let meta: Meta | null = null;

  try {
    meta = await fetchMetaOnServer();
  } catch (cause) {
    if (!(cause instanceof ApiError)) {
      throw cause;
    }
    // If backend is unreachable, pass null meta - ProgressView will handle it
  }

  return <ProgressView meta={meta} />;
}