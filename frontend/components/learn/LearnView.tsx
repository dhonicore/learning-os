"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Meta, ToolResult } from "@/types/api";

import { SqlEditor } from "@/components/learn/SqlEditor";
import { ActionBar } from "@/components/learn/ActionBar";
import { QuestionHeader } from "@/components/learn/QuestionHeader";
import { SchemaPanel } from "@/components/learn/SchemaPanel";
import { TutorPanel } from "@/components/learn/TutorPanel";
import { ErrorAlert } from "@/components/learn/ErrorAlert";
import { useActivity, type ActivityEntry } from "@/lib/activity-context";

type AttemptsMap = Record<number, number>;
type DraftsMap = Record<number, string>;

type TutorTurnResponse = {
  reply: string;
  history: unknown[];
  attempt: number;
  tool_result: ToolResult;
};

type ErrorState = {
  message: string;
  canRetry: boolean;
  retryAction?: () => void;
} | null;

function lastOutcomeOf(
  tutorResult: ToolResult | null,
  error: ErrorState,
): "correct" | "incorrect" | null {
  if (error !== null || tutorResult === null) return null;
  return tutorResult.correct ? "correct" : "incorrect";
}

/** Friendly error text for learner-facing UI. Never exposes raw codes or commands. */
function friendlyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("cannot reach") || lower.includes("fetch") || message.startsWith("HTTP 0")) {
    return "Cannot reach the tutor service. Make sure the backend is running, then retry.";
  }
  if (/^HTTP \d+:/.test(message)) {
    return "The tutor service returned an error. Please wait a moment and try again.";
  }
  return message;
}

// ---------------------------------------------------------------------------
// Learn workspace — focused SQL learning surface.
// ---------------------------------------------------------------------------

export function LearnView({ meta, loadError }: { meta: Meta | null; loadError: string | null }) {
  const { addEntry, activityLog } = useActivity();

  const metaData = meta;
  const initialSelectedId = metaData?.questions[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [tutorResult, setTutorResult] = useState<ToolResult | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState<number | null>(null);
  const [gaveUp, setGaveUp] = useState<boolean>(false);
  const [attempts, setAttempts] = useState<AttemptsMap>({});
  const [drafts, setDrafts] = useState<DraftsMap>({});
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<ErrorState>(null);
  const [duplicate, setDuplicate] = useState<boolean>(false);

  const lastSubmitSigRef = useRef<{ sig: string; ts: number } | null>(null);
  const DUPLICATE_WINDOW_MS = 1500;

  const currentDraft = drafts[selectedId ?? 0] ?? "";

  const completedIds = useMemo(
    () => new Set(activityLog.filter((e) => e.correct).map((e) => e.qid)),
    [activityLog],
  );

  const handleQuestionSelect = useCallback((id: number) => {
    setSelectedId(id);
    setTutorResult(null);
    setReply(null);
    setHintLevel(null);
    setGaveUp(false);
    setError(null);
    setDuplicate(false);
    setAttempts((prev) => ({ ...prev, [id]: prev[id] ?? 0 }));
  }, []);

  const handleNextQuestion = useCallback(() => {
    if (!metaData?.questions.length) return;
    const currentIndex = metaData.questions.findIndex((q) => q.id === selectedId);
    const next = metaData.questions[currentIndex + 1];
    if (next) {
      handleQuestionSelect(next.id);
    }
  }, [metaData, selectedId, handleQuestionSelect]);

  const handleDraftChange = useCallback((qid: number, sql: string) => {
    setDrafts((prev) => ({ ...prev, [qid]: sql }));
  }, []);

  const executeTutorTurnRef = useRef<((isGiveUp: boolean) => Promise<void>) | null>(null);

  const executeTutorTurn = useCallback(async (isGiveUp: boolean) => {
    if (selectedId == null) return;
    const sig = JSON.stringify([selectedId, currentDraft.trim(), isGiveUp]);
    const now = performance.now();
    const prev = lastSubmitSigRef.current;
    if (prev !== null && prev.sig === sig && now - prev.ts < DUPLICATE_WINDOW_MS) {
      setDuplicate(true);
      return;
    }
    setDuplicate(false);
    setTutorResult(null);
    setReply(null);
    setHintLevel(null);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/tutor/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: selectedId,
          learner_sql: isGiveUp ? "" : currentDraft,
          history: [],
          attempt_number: (attempts[selectedId] ?? 0) + 1,
          gave_up: isGiveUp,
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        let message = `HTTP ${response.status}: ${errText}`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.detail) message = errJson.detail;
        } catch {
          // use raw text
        }
        throw new Error(message);
      }
      const data = await response.json() as TutorTurnResponse;
      setTutorResult(data.tool_result);
      setReply(data.reply);
      setHintLevel(data.tool_result.hint_level);
      if (isGiveUp) setGaveUp(true);

      const newEntry: ActivityEntry = {
        qid: selectedId,
        title: metaData?.questions.find((q) => q.id === selectedId)?.question ?? "",
        correct: data.tool_result.correct,
        attempt: data.attempt,
        hint_level: data.tool_result.hint_level,
        gave_up: data.tool_result.gave_up,
        timestamp: new Date().toISOString().slice(0, 19),
      };
      addEntry(newEntry);

      setAttempts((prev) => ({ ...prev, [selectedId]: data.attempt }));
      lastSubmitSigRef.current = { sig, ts: performance.now() };
    } catch (err) {
      lastSubmitSigRef.current = null;
      const raw = err instanceof Error ? err.message : "Unknown error";
      setError({
        message: friendlyError(raw),
        canRetry: true,
        retryAction: () => executeTutorTurnRef.current?.(isGiveUp),
      });
    } finally {
      setPending(false);
    }
  }, [selectedId, currentDraft, attempts, metaData, addEntry]);

  useEffect(() => {
    executeTutorTurnRef.current = executeTutorTurn;
  }, [executeTutorTurn]);

  const handleSubmit = useCallback(() => executeTutorTurn(false), [executeTutorTurn]);
  const handleGiveUp = useCallback(() => executeTutorTurn(true), [executeTutorTurn]);

  if (loadError) {
    return (
      <div className="p-8">
        <h1 className="text-[1.75rem] font-semibold leading-tight sm:text-[2.25rem]">
          The workspace could not load
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-error">{friendlyError(loadError)}</p>
      </div>
    );
  }

  if (!metaData) {
    return (
      <div className="p-8">
        <h1 className="text-[1.75rem] font-semibold leading-tight sm:text-[2.25rem]">
          Loading workspace…
        </h1>
        <p className="mt-4 text-sm text-muted">Fetching question metadata.</p>
      </div>
    );
  }

  const qidEntries = activityLog.filter((e) => e.qid === selectedId);
  const earlierAttemptEntries = tutorResult !== null ? qidEntries.slice(0, -1) : qidEntries;

  return (
    <div data-testid="learn-workspace" className="flex flex-col gap-8 lg:gap-10">
      <QuestionHeader
        meta={meta}
        selectedId={selectedId}
        completedIds={completedIds}
        onSelect={handleQuestionSelect}
      />

      {/* Workspace: reference + query as one coherent surface */}
      <section aria-label="Workspace" className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-4">
          <SchemaPanel open={true} />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-8">
          <SqlEditor
            value={currentDraft}
            onChange={(sql) => handleDraftChange(selectedId ?? 0, sql)}
            disabled={pending}
          />

          {error && (
            <ErrorAlert
              message={error.message}
              onDismiss={() => setError(null)}
              onRetry={error.retryAction}
            />
          )}

          <ActionBar
            qid={selectedId ?? 0}
            sql={currentDraft}
            pending={pending}
            gaveUp={gaveUp}
            onSubmit={handleSubmit}
            onGiveUp={handleGiveUp}
            attemptsMap={attempts}
            duplicate={duplicate}
            lastOutcome={lastOutcomeOf(tutorResult, error)}
          />

          <TutorPanel
            toolResult={tutorResult}
            reply={reply}
            hintLevel={hintLevel}
            earlierAttempts={earlierAttemptEntries.map((e) => ({
              attempt: e.attempt,
              correct: e.correct,
              hintLevel: e.hint_level ?? undefined,
              gaveUp: e.gave_up,
            }))}
            onNextQuestion={handleNextQuestion}
            hasNextQuestion={
              metaData.questions.findIndex((q) => q.id === selectedId) <
              metaData.questions.length - 1
            }
          />
        </div>
      </section>
    </div>
  );
}
