"use client";

import { cn } from "@/lib/cn";

/** Action bar with Check answer and Give Up buttons.
 *
 * The action is part of the workspace flow: Check → Checking… → outcome.
 * The visible verdict lives in TutorPanel; this bar carries the action and a
 * screen-reader-only status line.
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
  /** Called when Check answer is clicked. */
  onSubmit: () => void;
  /** Called when Give Up is clicked. */
  onGiveUp: () => void;
  /** Attempts per question for the caption. */
  attemptsMap: Record<number, number>;
  /** True when the last click was ignored as a duplicate (1.5 s window). */
  duplicate: boolean;
  /** Outcome of the most recent completed turn. */
  lastOutcome: "correct" | "incorrect" | null;
}

/** Text for the live submission-status line (screen readers only). */
function statusText(pending: boolean, lastOutcome: "correct" | "incorrect" | null): string | null {
  if (pending) return "Checking your query…";
  if (lastOutcome === "correct") return "Correct.";
  if (lastOutcome === "incorrect") return "Not quite yet — see feedback below.";
  return null;
}

export function ActionBar({
  sql,
  pending,
  gaveUp,
  onSubmit,
  onGiveUp,
  duplicate,
  lastOutcome,
}: ActionBarProps) {
  const status = statusText(pending, lastOutcome);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onSubmit}
          disabled={pending || sql.trim().length === 0}
          data-testid="submit-sql"
          className={cn(
            "btn btn-primary rounded-ctl px-5",
            pending && "text-ink!",
          )}
        >
          {pending ? "Checking…" : "Check answer"}
        </button>

        <button
          onClick={onGiveUp}
          disabled={pending || gaveUp}
          data-testid="give-up"
          className={cn(
            "text-sm font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
            gaveUp && "opacity-50",
          )}
        >
          Give up
        </button>

        {/* Live region for assistive technology; not a visible duplicate of the verdict. */}
        <span
          role="status"
          data-testid="submit-status"
          className="sr-only"
        >
          {status ?? ""}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {duplicate && (
          <span className="text-xs text-muted" data-testid="duplicate-caption">
            Duplicate submission ignored
          </span>
        )}
        {!duplicate && (
          <span className="text-xs text-muted">
            Your query will be checked against the database.
          </span>
        )}
      </div>
    </div>
  );
}
