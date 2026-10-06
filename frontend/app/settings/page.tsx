import type { Metadata } from "next";

import { SettingsView } from "@/components/settings/SettingsView";
import { ApiError, fetchMetaOnServer } from "@/lib/api";

export const metadata: Metadata = { title: "Settings" };

/** Reads live backend data on every request: never statically prerendered. */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let questionCount: number | null = null;
  let practiceCount: number | null = null;
  let heldOutCount: number | null = null;

  try {
    const meta = await fetchMetaOnServer();
    questionCount = meta.questions.length;
    practiceCount = meta.practice_ids.length;
    heldOutCount = meta.held_ids.length;
  } catch (cause) {
    if (!(cause instanceof ApiError)) {
      throw cause;
    }
  }

  return (
    <SettingsView
      counts={{ questionCount, practiceCount, heldOutCount }}
    />
  );
}
