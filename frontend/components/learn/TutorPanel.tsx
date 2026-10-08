"use client";

import { cn } from "@/lib/cn";
import type { ToolResult } from "@/types/api";

/** Tutor panel — the learner-facing learning guide.
 *
 *  One turn of E5 `run_tutor_turn` produces everything shown here:
 *   - Verdict banner: "Correct" / "Not quite" + the plain-language reason
 *     label from the backend (`_REASON_LABELS` — never re-mapped locally).
 *   - Attempt line: orientation only ("Attempt 2"). The old
 *     "Attempt n · hint level k of 4 · gave up" meta line exposed
 *     implementation language and internal state.
 *   - Reference-solution state: on a Give Up turn this replaces the verdict,
 *     so the gave-up moment has exactly one learner-facing statement (the
 *     old panel rendered three).
 *   - Tutor guidance: the reply, rendered as the most legible text in the
 *     panel, through a markdown renderer that never emits raw HTML.
 *   - Guidance phrase: hint_level only *selects* presentation language
 *     ("A small nudge" → "The full solution"); its value and policy are
 *     unchanged and the number is never printed.
 *   - Earlier attempts: collapsed supporting history in plain language.
 *
 *  Developer-facing content (hint-context JSON, "model saw" payloads) is
 *  intentionally absent from the learner path.
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
}

/** Learner-facing phrasing for how much guidance this attempt carried.
    Keys off hint_level only; returns null when no phrase applies (correct
    turns, or a level the response does not provide). */
function guidancePhrase(correct: boolean, hintLevel: number | null): string | null {
  if (correct || hintLevel === null) return null;
  if (hintLevel <= 1) return "A small nudge";
  if (hintLevel === 2) return "A stronger clue";
  if (hintLevel === 3) return "Here's the key idea";
  return "The full solution";
}

/** One earlier attempt as a plain-language row. The activity log stores
    attempt number, outcome, hint level and gave-up only — there is no
    per-attempt reason or reply to show. */
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

/** Inline markdown (**bold**, *em*) → React nodes.
 *
 *  Text is only ever pushed as children, never as HTML: React escapes it,
 *  so model output such as `<img onerror=…>` renders as literal text. The
 *  previous implementation regex-replaced markdown into tags and injected
 *  the line with dangerouslySetInnerHTML (audit §9.5).
 */
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

/** Minimal safe markdown renderer for the patterns the tutor actually
    produces: ``` fenced code blocks, **bold**, *em*, line breaks.
    Every string becomes a React text child — no HTML path exists. */
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
    // A trailing newline from a code fence is not a real blank line.
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
}: TutorPanelProps) {
  const hasResult = toolResult !== null;
  const gaveUpTurn = toolResult?.gave_up === true;
  // Attempt orientation: prior turns + the turn on display (unchanged from
  // the attempt-number fix — the current turn is never double-counted).
  const attemptNumber = earlierAttempts.length + (toolResult ? 1 : 0);
  const reasonText = toolResult?.reason_label ?? "";
  const phrase =
    hasResult && !gaveUpTurn ? guidancePhrase(toolResult.correct, hintLevel) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="tutor-panel">
      {/* Idle: calm empty state. No fabricated tutor content, no internal
          state ("Attempt 0 · no hint"). */}
      {!hasResult && (
        <div className="flex flex-col gap-3" data-testid="tutor-idle">
          <h2 className="eyebrow">Tutor</h2>
          <p className="text-sm leading-relaxed text-muted">
            Check your SQL to get the checker&rsquo;s verdict, then the
            tutor&rsquo;s explanation. If you need another attempt, the
            guidance grows stronger.
          </p>
        </div>
      )}

      {/* Give Up: the single learner-facing state for disclosure. Replaces
          the verdict on this turn (the learner did not fail — they asked
          for the answer); the button already carries the persistent
          "given up" state afterwards. */}
      {hasResult && gaveUpTurn && (
        <div
          className="flex flex-col gap-1 rounded-ctl border border-line bg-raised p-3"
          data-testid="tutor-gave-up"
        >
          <h2 className="text-sm font-semibold text-ink">
            Reference solution revealed
          </h2>
          <p className="text-xs leading-relaxed text-muted">
            You chose Give Up, so the reference SQL and the tutor&rsquo;s
            walkthrough appear below.
          </p>
        </div>
      )}

      {/* Verdict: word + plain-language reason. Never colour alone. The
          filled banner shares the success/error tokens with the near-action
          status line, so the correct state reads as one result. */}
      {hasResult && !gaveUpTurn && (
        <div
          className={cn(
            "flex flex-col gap-1 rounded-ctl p-3",
            toolResult.correct ? "bg-success text-on-accent" : "bg-error text-on-accent",
          )}
          data-testid="tutor-status"
        >
          <h2 className="text-sm font-semibold">
            {toolResult.correct ? "Correct" : "Not quite"}
          </h2>
          {reasonText && <p className="text-sm">{reasonText}</p>}
        </div>
      )}

      {/* Attempt orientation — the number only. */}
      {hasResult && (
        <p className="text-xs text-muted" data-testid="turn-meta">
          Attempt {attemptNumber}
        </p>
      )}

      {/* Tutor guidance: the most legible text in the panel. */}
      {reply !== null && reply !== "" && (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">{gaveUpTurn ? "Reference solution" : "Tutor"}</h3>
          <div
            className="flex flex-col gap-1 break-words text-sm leading-relaxed text-ink"
            data-testid="tutor-reply"
          >
            {renderMarkdown(reply)}
          </div>
        </div>
      )}

      {/* Progression, in learner language, after the guidance it describes. */}
      {phrase !== null && (
        <p className="flex flex-wrap items-baseline gap-2" data-testid="guidance-phrase">
          <span className="eyebrow">Guidance</span>
          <span className="text-xs font-medium text-ink">{phrase}</span>
        </p>
      )}

      {/* Earlier attempts: supporting history, collapsed by default. Native
          details/summary keeps it keyboard accessible. */}
      {earlierAttempts.length > 0 && (
        <details>
          <summary
            className="cursor-pointer text-sm font-medium text-primary underline"
            data-testid="earlier-attempts"
          >
            Earlier attempts ({earlierAttempts.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
            {earlierAttempts.map((a) => (
              <li key={a.attempt}>{attemptRowLabel(a)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
