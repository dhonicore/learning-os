"use client";

import { cn } from "@/lib/cn";

/** Action bar with Submit SQL and Give Up buttons.
 *
 * - Duplicate guard lives in `LearnView.executeTutorTurn` (mirrors Streamlit
 *   `_run_turn`): same `(qid, sql.strip(), gaveUp)` tuple within 1.5 s is
 *   ignored and surfaces via the `duplicate` caption. This component is
 *   presentational only and never disables buttons for duplicates.
 * - Pending state disables both buttons while a tutor turn is in flight.
 * - Give Up is disabled after the question has `gaveUp = true`.
 * - Colours and shapes match the Phase 2 design system (no decorative
 *   gradients, hairline borders only).
 */
export interface ActionBarProps {
  /** Current question ID. */
  qid: number;
  /** Current SQL draft for this question. */
  sql: string;
  /** Whether a tutor turn is currently in flight (pending). */
  pending: boolean;
  /** Whether the current question has already been given up. */
  gaveUp: boolean;
  /** Called when Submit is clicked. */
  onSubmit: () => void;
  /** Called when Give Up is clicked. */
  onGiveUp: () => void;
  /** Attempts per question for the caption. */
  attemptsMap: Record<number, number>;
  /** True when the last click was ignored as a duplicate (1.5 s window). */
  duplicate: boolean;
}

/** Format attempts caption, mirroring Streamlit's per-question attempt tracking. */
function attemptsCaption(qid: number | null, attempts: Record<number, number>): string {
  if (qid == null || !(qid in attempts)) return "No attempts yet";
  const a = attempts[qid];
  return a === 1 ? `1 attempt` : `${a} attempts`;
}

export function ActionBar({
  qid,
  sql,
  pending,
  gaveUp,
  onSubmit,
  onGiveUp,
  attemptsMap,
  duplicate,
}: ActionBarProps) {
  const caption = attemptsCaption(qid, attemptsMap);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={onSubmit}
        disabled={pending || sql.trim().length === 0}
        data-testid="submit-sql"
        className={cn(
          "btn btn-primary rounded-ctl px-6",
          pending && "opacity-50 not-allowed",
        )}
      >
        Submit SQL
      </button>
      <button
        onClick={onGiveUp}
        disabled={pending || gaveUp}
        data-testid="give-up"
        className={cn(
          "btn btn-ghost rounded-ctl text-muted px-6",
          gaveUp && "opacity-50 cursor-not-allowed",
        )}
      >
        Give Up
      </button>
      <span className="text-xs text-muted" data-testid="duplicate-caption">
        {duplicate && "Duplicate submission ignored (1.5 s window)"}
      </span>
      <span className="text-xs text-muted"> {caption} </span>
    </div>
  );
}