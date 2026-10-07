"use client";

import { cn } from "@/lib/cn";
import type { ToolResult } from "@/types/api";

/** Tutor panel — displays the reply, hint level, and earlier attempts
 *  from a single E5 `run_tutor_turn` round-trip.
 *
 *  Mirrors Streamlit's `_render_tutor_panel`:
 *   - StatusBanner: correct / incorrect + reason_label
 *   - TurnMeta: "Attempt n · hint level k of 4 · gave up"
 *   - Reply: markdown-rendered tutor reply
 *   - HintContext: what the model was allowed to see at this level
 *   - EarlierAttempts: accordion of prior attempts + outcomes
 *   - GaveUpNote: shown when gaveUp is true
 */
export interface TutorPanelProps {
  /** The tool_result from the most recent E5 response. */
  toolResult: ToolResult | null;
  /** The free-form reply text from the LLM. */
  reply: string | null;
  /** Hint level 0–4 as computed by the backend. */
  hintLevel: number | null;
  /** Whether Give Up was used on this turn. */
  gaveUp: boolean;
  /** Array of earlier attempt summaries (from prior turns). */
  earlierAttempts: Array<{ attempt: number; correct: boolean; reason?: string; hintLevel?: number; gaveUp: boolean }>;
}

/** Reason labels come from the backend (`toolResult.reason_label`, sourced
 *  from app.py `_REASON_LABELS`). No local map: duplicating it let raw reason
 *  codes reach learners whenever a new reason shipped without a label here. */

/** Format attempt·hint meta line. */
function turnMeta(attempt: number, hintLevel: number | null, gaveUp: boolean): string {
  const hintStr = hintLevel !== null ? `hint level ${hintLevel} of 4` : "no hint";
  const gaveUpStr = gaveUp ? " · gave up" : "";
  return `Attempt ${attempt} · ${hintStr}${gaveUpStr}`;
}

/** What the model saw at each hint level — mirrors hint_policy.tool_context_for_level */
function hintContextDescription(level: number | null, toolResult: ToolResult | null): React.ReactNode {
  if (level === null || toolResult === null) return null;

  const reasonText = toolResult.reason_label;

  switch (level) {
    case 0:
      return (
        <div className="text-xs text-success font-medium">
          ✓ Correct answer — model saw: <code className="font-mono bg-code px-1 rounded">{JSON.stringify({ correct: true })}</code>
        </div>
      );
    case 1:
      return (
        <div className="text-xs text-muted">
          Level 1: Model only knows the answer is incorrect.
          <br />
          <code className="font-mono bg-code px-1 rounded">{JSON.stringify({ correct: false, hint_level: 1 })}</code>
        </div>
      );
    case 2:
      return (
        <div className="text-xs text-muted">
          Level 2: Model knows the answer is incorrect and the reason: <strong>{reasonText}</strong>.
          <br />
          <code className="font-mono bg-code px-1 rounded">{JSON.stringify({ correct: false, reason: toolResult.reason, hint_level: 2 })}</code>
        </div>
      );
    case 3:
      return (
        <div className="text-xs text-muted">
          Level 3: Model sees reason (<strong>{reasonText}</strong>), learner row count ({toolResult.row_diff[0]} vs reference {toolResult.row_diff[1]}), and learner output rows.
          <br />
          <code className="font-mono bg-code px-1 rounded">{JSON.stringify({
            correct: false,
            reason: toolResult.reason,
            row_diff: toolResult.row_diff,
            learner_rows: toolResult.learner_rows,
            hint_level: 3
          })}</code>
        </div>
      );
    case 4:
      return (
        <div className="text-xs text-warning">
          Level 4: Model sees full checker context + <strong>reference SQL disclosed</strong>.
          <code className="font-mono bg-code px-1 rounded">{JSON.stringify({
            correct: false,
            reason: toolResult.reason,
            row_diff: toolResult.row_diff,
            learner_rows: toolResult.learner_rows,
            hint_level: 4
          })}</code>
        </div>
      );
    default:
      return null;
  }
}

/** Simple markdown-like rendering for tutor replies. */
function renderMarkdown(text: string): React.ReactNode {
  // Split by code blocks first
  const parts = text.split(/```(?:sql)?\n?/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // This is a code block (between backticks)
      return <pre key={i} className="bg-code rounded-ctl p-3 overflow-x-auto my-2"><code className="font-mono text-sm">{part.trim()}</code></pre>;
    }
    // Regular text - convert simple markdown
    return (
      <div key={i} className="prose max-w-none text-muted break-all whitespace-pre-wrap">
        {part
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>")
          .split("\n")
          .map((line, li) => (
            <div key={li} dangerouslySetInnerHTML={{ __html: line }} />
          ))}
      </div>
    );
  });
}

export function TutorPanel({
  toolResult,
  reply,
  hintLevel,
  gaveUp,
  earlierAttempts
}: TutorPanelProps) {
  const reasonText = toolResult?.reason_label ?? "";

  // Status banner: "correct" or "incorrect" with reason
  const statusClass = toolResult?.correct
    ? "bg-success text-on-accent"
    : "bg-error text-on-accent";

  return (
    <div className="space-y-4">
      {/* Status banner */}
      {toolResult !== null && (
        <div className={cn("rounded-ctl p-3", statusClass)} data-testid="tutor-status">
          <span className="font-medium">
            {toolResult.correct ? "Correct" : "Incorrect"}
          </span>
          {reasonText && <span className="ml-2 text-xs-muted">({reasonText})</span>}
        </div>
      )}

      {/* Hint context — what the model was allowed to see */}
      {toolResult !== null && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-primary underline font-medium flex items-center gap-1">
            <span>Hint context (level {hintLevel ?? "—"})</span>
            <span className="text-muted">(click to expand)</span>
          </summary>
          <div className="mt-2 p-2 bg-code rounded-ctl text-xs">
            {hintContextDescription(hintLevel, toolResult)}
          </div>
        </details>
      )}

      {/* Turn meta + gave-up note */}
      <div className="flex items-baseline gap-3">
        <span className="text-xs text-muted" data-testid="turn-meta">
          {turnMeta(
            earlierAttempts.length + (toolResult ? 1 : 0),
            hintLevel,
            gaveUp,
          )}
        </span>
        {gaveUp && (
          <div className="text-xs text-muted">
            <strong>Give Up</strong> — the reference SQL is now disclosed.
          </div>
        )}
      </div>

      {/* Reply (markdown-rendered) */}
      {reply !== null && (
        <div className="prose max-w-none text-muted break-all" data-testid="tutor-reply">
          {renderMarkdown(reply)}
        </div>
      )}

      {/* Earlier attempts accordion */}
      {earlierAttempts.length > 0 && (
        <div className="mt-3">
          <details>
            <summary className="cursor-pointer text-primary underline text-sm font-medium">
              Earlier attempts ({earlierAttempts.length})
            </summary>
            <div className="space-y-2 text-xs text-muted">
              {earlierAttempts.map((a, i) => (
                <div key={i} className="font-mono">
                  <div>
                    Attempt {a.attempt}: {a.correct ? "correct" : "incorrect"}
                  </div>
                  {a.reason && <div>{a.reason}</div>}
                  {a.hintLevel !== undefined && (
                    <div>hint level {a.hintLevel} of 4</div>
                  )}
                  {a.gaveUp && <div>gave up</div>}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Gave-up note when the question-level gaveUp flag is true. */}
      {gaveUp && (
        <p className="text-xs text-muted">
          Selecting Give Up disclosed the reference solution for this question.
        </p>
      )}
    </div>
  );
}