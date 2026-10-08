"use client";

import { cn } from "@/lib/cn";

type ProgressState = "upcoming" | "current" | "completed" | "current-completed";

export interface ProgressRailProps {
  /** Total question metadata: at minimum an id. */
  questions: Array<{ id: number }>;
  /** Currently selected question id. */
  selectedId: number | null;
  /** ids the learner has solved correctly. */
  completedIds: Set<number>;
  /** Called when the user selects a question. */
  onSelect: (id: number) => void;
}

function nodeState(id: number, selectedId: number | null, completedIds: Set<number>): ProgressState {
  if (id === selectedId) return completedIds.has(id) ? "current-completed" : "current";
  if (completedIds.has(id)) return "completed";
  return "upcoming";
}

export function ProgressRail({
  questions,
  selectedId,
  completedIds,
  onSelect,
}: ProgressRailProps) {
  return (
    <nav aria-label="Questions" className="w-full">
      <ol className="flex items-center gap-0" role="list">
        {questions.map((q, index) => {
          const state = nodeState(q.id, selectedId, completedIds);
          const isCurrent = state === "current" || state === "current-completed";
          const isCompleted = state === "completed" || state === "current-completed";
          const isLast = index === questions.length - 1;

          return (
            <li key={q.id} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                onClick={() => onSelect(q.id)}
                data-testid={`qnav-Q${q.id}`}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Question ${q.id}${isCompleted ? " completed" : ""}${isCurrent ? " current" : ""}`}
                className={cn(
                  "group relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-all duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 sm:h-8 sm:w-8 sm:text-sm",
                  state === "current" &&
                    "bg-accent text-on-accent shadow-sm scale-110",
                  state === "completed" &&
                    "bg-success text-on-accent",
                  state === "current-completed" &&
                    "bg-success text-on-accent shadow-sm ring-2 ring-accent ring-offset-2 ring-offset-canvas scale-110",
                  state === "upcoming" &&
                    "border border-line bg-canvas text-muted hover:border-accent hover:text-accent",
                )}
              >
                {isCompleted ? (
                  <svg
                    className="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  q.id
                )}
              </button>

              {!isLast && (
                <span
                  className={cn(
                    "mx-1 h-px min-w-0 flex-1 transition-colors duration-150 ease-out",
                    completedIds.has(q.id) && questions[index + 1] &&
                      (completedIds.has(questions[index + 1].id) || questions[index + 1].id === selectedId)
                      ? "bg-accent"
                      : "bg-line",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
