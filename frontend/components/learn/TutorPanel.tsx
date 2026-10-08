"use client";

import { cn } from "@/lib/cn";
import type { ToolResult } from "@/types/api";

/** Tutor feedback: contextual guidance attached to the learner's attempt.
 *
 *  - Appears as a meaningful state transition, not a chat card.
 *  - Verdict is a clear semantic card with icon and title.
 *  - Attempt count and guidance phrase are merged into one line.
 *  - Correct state surfaces a primary Next question action.
 *  - The reply is plain typography and code blocks.
 */
export interface TutorPanelProps {
  /** The tool_result from the most recent E5 response. */
  toolResult: ToolResult | null;
  /** The free-form reply text from the LLM. */
  reply: string | null;
  /** Hint level 0–4 as computed by the backend. Used only to pick the
      learner-facing guidance phrase — never rendered as a number. */
  hintLevel: number | null;
  /** Array of earlier attempt summaries (from prior turns). */
  earlierAttempts: Array<{ attempt: number; correct: boolean; hintLevel?: number; gaveUp: boolean }>;
  /** Called when the learner clicks Next question after a correct answer. */
  onNextQuestion?: () => void;
  /** Whether there is a next question to advance to. */
  hasNextQuestion?: boolean;
}

/** Learner-facing phrasing for how much guidance this attempt carried. */
function guidancePhrase(correct: boolean, hintLevel: number | null): string | null {
  if (correct || hintLevel === null) return null;
  if (hintLevel <= 1) return "A small nudge";
  if (hintLevel === 2) return "A stronger clue";
  if (hintLevel === 3) return "Here's the key idea";
  return "The full solution";
}

/** One earlier attempt as a plain-language row. */
function attemptRowLabel(a: {
  attempt: number;
  correct: boolean;
  hintLevel?: number;
  gaveUp: boolean;
}): string {
  const outcome = a.correct ? "Correct" : a.gaveUp ? "Gave up" : "Not quite";
  const phrase = a.correct || a.gaveUp ? null : guidancePhrase(false, a.hintLevel ?? null);
  return `Attempt ${a.attempt} · ${outcome}${phrase ? ` · ${phrase}` : ""}`;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Minimal safe markdown renderer: fenced code blocks, **bold**, *em*. */
function inlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/```(?:sql)?\n?/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <pre key={i} className="overflow-x-auto rounded-ctl bg-code p-3">
          <code className="font-mono text-sm">{part.trim()}</code>
        </pre>
      );
    }
    const lines = part.split("\n");
    const shown = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
    return (
      <div key={i} className="flex flex-col gap-1">
        {shown.map((line, li) => (
          <div key={li}>{line.trim() === "" ? "\u00A0" : inlineMarkdown(line)}</div>
        ))}
      </div>
    );
  });
}

export function TutorPanel({
  toolResult,
  reply,
  hintLevel,
  earlierAttempts,
  onNextQuestion,
  hasNextQuestion = false,
}: TutorPanelProps) {
  const hasResult = toolResult !== null;
  if (!hasResult) return null;

  const gaveUpTurn = toolResult.gave_up === true;
  const attemptNumber = earlierAttempts.length + 1;
  const reasonText = toolResult.reason_label ?? "";
  const phrase = gaveUpTurn ? null : guidancePhrase(toolResult.correct, hintLevel);

  return (
    <div
      className="flex flex-col gap-4 animate-feedback"
      data-testid="tutor-panel"
    >
      {gaveUpTurn && (
        <div
          className="rounded-ctl border border-muted bg-raised p-4"
          data-testid="tutor-gave-up"
        >
          <div className="flex items-start gap-3">
            <AlertIcon className="mt-0.5 size-5 shrink-0 text-muted" />
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-ink">Reference solution revealed</h2>
              <p className="text-sm text-muted">
                You chose Give up, so the reference SQL and walkthrough appear below.
              </p>
            </div>
          </div>
        </div>
      )}

      {!gaveUpTurn && (
        <div
          className={cn(
            "rounded-ctl border p-4",
            toolResult.correct
              ? "border-success bg-success-surface"
              : "border-error bg-error-surface",
          )}
          data-testid="tutor-status"
        >
          <div className="flex items-start gap-3">
            {toolResult.correct ? (
              <CheckIcon className="mt-0.5 size-5 shrink-0 text-success" />
            ) : (
              <AlertIcon className="mt-0.5 size-5 shrink-0 text-error" />
            )}
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h2
                  className={cn(
                    "text-base font-semibold",
                    toolResult.correct ? "text-success" : "text-error",
                  )}
                >
                  {toolResult.correct ? "Correct" : "Not quite"}
                </h2>
                {reasonText && <p className="text-sm text-ink">{reasonText}</p>}
              </div>

              <p className="text-xs text-muted" data-testid="turn-meta">
                Attempt {attemptNumber}
                {phrase ? ` · ${phrase}` : ""}
              </p>

              {toolResult.correct && hasNextQuestion && onNextQuestion && (
                <button
                  type="button"
                  onClick={onNextQuestion}
                  className="btn btn-primary mt-1 w-full rounded-ctl sm:w-auto"
                >
                  Next question
                  <svg
                    className="ml-1 size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {gaveUpTurn && (
        <p className="text-xs text-muted" data-testid="turn-meta">
          Attempt {attemptNumber}
        </p>
      )}

      {reply !== null && reply !== "" && (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">{gaveUpTurn ? "Reference solution" : "Guidance"}</h3>
          <div
            className="flex flex-col gap-1 break-words text-sm leading-relaxed text-ink"
            data-testid="tutor-reply"
          >
            {renderMarkdown(reply)}
          </div>
        </div>
      )}

      {earlierAttempts.length > 0 && (
        <div className="rounded-ctl border border-line bg-surface p-4">
          <h3 className="eyebrow mb-2" data-testid="earlier-attempts">
            Earlier attempts ({earlierAttempts.length})
          </h3>
          <ul className="flex flex-col gap-1.5 text-xs text-muted">
            {earlierAttempts.map((a) => (
              <li key={a.attempt}>{attemptRowLabel(a)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
