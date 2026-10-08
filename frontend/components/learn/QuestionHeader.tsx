"use client";

import { useMemo } from "react";
import { Eyebrow } from "@/components/ui/primitives";
import { ProgressRail } from "@/components/learn/ProgressRail";

/** Question-first header.
 *
 * The question text is the page's dominant heading. Progress is communicated
 * as a learning rail, not a row of generic pills.
 */
export interface QuestionHeaderProps {
  /** Metadata from E2. */
  meta: import("@/types/api").Meta | null;
  /** Currently selected question ID. */
  selectedId: number | null;
  /** ids the learner has solved correctly. */
  completedIds: Set<number>;
  /** Called when the user selects a different question. */
  onSelect: (id: number) => void;
}

export function QuestionHeader({
  meta,
  selectedId,
  completedIds,
  onSelect,
}: QuestionHeaderProps) {
  const questions = useMemo(() => meta?.questions ?? [], [meta]);
  const selected = useMemo(() => {
    if (questions.length === 0) return null;
    return questions.find((q) => q.id === selectedId) ?? questions[0];
  }, [questions, selectedId]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-2 sm:gap-3">
        <Eyebrow>
          Question {selected?.id ?? "—"} of {questions.length}
        </Eyebrow>
        {selected?.question ? (
          <h1
            data-testid="question-text"
            className="max-w-3xl text-balance text-[1.875rem] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[2.5rem] lg:text-[2.75rem]"
          >
            {selected.question}
          </h1>
        ) : null}
      </div>

      <ProgressRail
        questions={questions}
        selectedId={selectedId}
        completedIds={completedIds}
        onSelect={onSelect}
      />
    </div>
  );
}
