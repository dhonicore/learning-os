"use client";

import { cn } from "@/lib/cn";

/** Action bar with Submit SQL and Give Up buttons.
 *
 * Slice B: this is also the submission-state surface. One continuous
 * interaction — Submit → Checking… → Correct / Not quite / Error — is
 * expressed here, next to the action that caused it:
 * - Pending disables both buttons (no second request while a turn is in
 *   flight) and swaps the Submit label to "Checking…".
 * - A `role="status"` line announces checking and the last outcome to screen
 *   readers; the outcome is words, never colour alone. The TutorPanel banner
 *   remains the detailed verdict — this line only connects it to the action.
 * - Duplicate guard lives in `LearnView.executeTutorTurn` (mirrors Streamlit
 *   `_run_turn`): same `(qid, sql.strip(), gaveUp)` tuple within 1.5 s is
 *   ignored and surfaces via the `duplicate` caption. This component is
 *   presentational only and never disables buttons for duplicates.
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
  /** Outcome of the most recent completed turn; null when there is none to
      report (fresh question, or an error is shown — the alert owns that). */
  lastOutcome: "correct" | "incorrect" | null;
}

/** Format attempts caption, mirroring Streamlit's per-question attempt tracking. */
function attemptsCaption(qid: number | null, attempts: Record<number, number>): string {
  if (qid == null || !(qid in attempts)) return "No attempts yet";
  const a = attempts[qid];
  return a === 1 ? `1 attempt` : `${a} attempts`;
}

/** Text for the live submission-status line. Pending wins over a previous
    outcome: while a turn is in flight the only truthful statement is that
    the submission is being checked. */
function statusText(pending: boolean, lastOutcome: "correct" | "incorrect" | null): string | null {
  if (pending) return "Checking your query…";
  if (lastOutcome === "correct") return "Correct.";
  if (lastOutcome === "incorrect") return "Not quite yet — see feedback below.";
  return null;
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
  lastOutcome,
}: ActionBarProps) {
  const caption = attemptsCaption(qid, attemptsMap);
  const status = statusText(pending, lastOutcome);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={onSubmit}
        disabled={pending || sql.trim().length === 0}
        data-testid="submit-sql"
        className={cn(
          "btn btn-primary rounded-ctl px-6",
          // Pending: daisyUI's disabled rule already dims bg (10% content) and
          // label (20% alpha) — enough to read as inactive, too faint for a
          // label that now carries meaning. text-ink! restores full contrast
          // so "Checking…" stays legible while disabled (WCAG 1.4.11/1.4.3).
          pending && "text-ink!",
        )}
      >
        {pending ? "Checking…" : "Submit SQL"}
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
      <span
        role="status"
        data-testid="submit-status"
        className={cn(
          "text-xs",
          lastOutcome === "correct" && !pending ? "text-success" : "text-muted",
        )}
      >
        {status}
      </span>
      <span className="text-xs text-muted" data-testid="duplicate-caption">
        {duplicate && "Duplicate submission ignored (1.5 s window)"}
      </span>
      <span className="text-xs text-muted"> {caption} </span>
    </div>
  );
}