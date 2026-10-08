"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/primitives";
import type { QuestionMeta } from "@/types/api";

/** Question-first header (audit Slice A).
 *
 * The question is the primary learning object, so it owns the top of the
 * page outright: a quiet identity line, then the question text itself as
 * the page's top-level heading, then navigation as a secondary group.
 * There is no page-title chrome and no wrapping card — the question carries
 * the visual weight through type alone.
 *
 * Mirrors Streamlit's `_render_question_nav` navigation:
 * - Practice / Held out pill groups for navigation (unchanged behaviour).
 * - Question number + purpose label as supporting metadata.
 */
export interface QuestionHeaderProps {
  /** Metadata from E2. */
  meta: import("@/types/api").Meta | null;
  /** Currently selected question ID. */
  selectedId: number | null;
  /** Called when the user selects a different question. */
  onSelect: (id: number) => void;
}

/** Format purpose tag: "Practice" or "Held out". */
function purposeTag(purpose: string | undefined): string {
  return purpose === "held_out" ? "Held out" : "Practice";
}

export function QuestionHeader({
  meta,
  selectedId,
  onSelect,
}: QuestionHeaderProps) {
  const questions = useMemo(() => meta?.questions ?? [], [meta]);
  const selected = useMemo<QuestionMeta | null>(() => {
    if (questions.length === 0) return null;
    return questions.find((q) => q.id === selectedId) ?? questions[0];
  }, [questions, selectedId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>
          Question {selected?.id ?? "—"} of {questions.length ?? "—"} · {purposeTag(selected?.purpose)}
        </Eyebrow>
        {selected?.question ? (
          <h1 data-testid="question-text" className="max-w-3xl text-[1.75rem] font-semibold leading-tight text-ink sm:text-[2rem]">
            {selected.question}
          </h1>
        ) : null}
      </div>

      <nav aria-label="Questions" className="flex flex-col sm:flex-row gap-2">
        <PracticePills
          label="Practice"
          ids={meta?.practice_ids ?? []}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
        />
        <HeldOutPills
          label="Held out"
          ids={meta?.held_ids ?? []}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
        />
      </nav>
    </div>
  );
}

/** Pill group for practice questions (Q1–Q5). */
function PracticePills({
  label,
  ids,
  selectedId,
  onSelect,
}: {
  label: string;
  ids: number[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="eyebrow">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const active = id === selectedId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={active}
              data-testid={`qnav-Q${id}`}
              className={cn(
                "rounded-ctl border px-3 py-1.5 font-mono text-sm transition-colors",
                active ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-muted hover:border-accent hover:text-ink",
              )}
            >
              Q{id}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pill group for held-out questions (Q6–Q8). */
function HeldOutPills({
  label,
  ids,
  selectedId,
  onSelect,
}: {
  label: string;
  ids: number[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="eyebrow">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const active = id === selectedId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={active}
              data-testid={`qnav-Q${id}`}
              className={cn(
                "rounded-ctl border px-3 py-1.5 font-mono text-sm transition-colors",
                active ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-muted hover:border-accent hover:text-ink",
              )}
            >
              Q{id}
            </button>
          );
        })}
      </div>
    </div>
  );
}