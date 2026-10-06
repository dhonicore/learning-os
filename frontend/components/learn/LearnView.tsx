"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Meta, ToolResult } from "@/types/api";

import { PageHeader, Panel, SectionHead } from "@/components/ui/primitives";
import { SqlEditor } from "@/components/learn/SqlEditor";
import { ActionBar } from "@/components/learn/ActionBar";
import { QuestionHeader } from "@/components/learn/QuestionHeader";
import { SchemaPanel } from "@/components/learn/SchemaPanel";
import { TutorPanel } from "@/components/learn/TutorPanel";
import { ErrorAlert } from "@/components/learn/ErrorAlert";
import { useActivity, type ActivityEntry } from "@/lib/activity-context";

// Type for the per-question attempts counter.
type AttemptsMap = Record<number, number>;

// Type for SQL drafts per question.
type DraftsMap = Record<number, string>;

// Type for tutor turn response.
type TutorTurnResponse = {
  reply: string;
  history: unknown[];
  attempt: number;
  tool_result: ToolResult;
};

// Type for error state.
type ErrorState = {
  message: string;
  canRetry: boolean;
  retryAction?: () => void;
} | null;

// ---------------------------------------------------------------------------
// Learn workspace — functional SQL learning surface with Monaco editor.
// ---------------------------------------------------------------------------

export function LearnView({ meta, loadError }: { meta: Meta | null; loadError: string | null }) {
  const { addEntry, activityLog } = useActivity();

  // --- API data ---
  // Use server-fetched meta prop; no client-side refetch needed (page is force-dynamic)
  const metaData = meta;
  // Derive selectedId from meta on first render; use state only for user-driven changes
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

  // Duplicate guard: mirrors Streamlit `_run_turn` / `last_submit_sig`.
  // Signature is (qid, sql.strip(), gaveUp); checked before the turn,
  // recorded after success, cleared on failure so a retry is never blocked.
  const lastSubmitSigRef = useRef<{ sig: string; ts: number } | null>(null);
  const DUPLICATE_WINDOW_MS = 1500;

  // Question selection
  const currentDraft = drafts[selectedId ?? 0] ?? "";

  // --- Handle question select ---
  const handleQuestionSelect = useCallback((id: number) => {
    setSelectedId(id);
    // Preserve draft (requirement); reset tutor state for new question
    setTutorResult(null);
    setReply(null);
    setHintLevel(null);
    setGaveUp(false);
    setError(null);
    setDuplicate(false);
    setAttempts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) }));
  }, []);

  // --- Handle draft change ---
  const handleDraftChange = useCallback((qid: number, sql: string) => {
    setDrafts((prev) => ({ ...prev, [qid]: sql }));
  }, []);

  // Use a ref to store the latest executeTutorTurn for retry
  const executeTutorTurnRef = useRef<((isGiveUp: boolean) => Promise<void>) | null>(null);

  // --- Shared tutor turn handler ---
  const executeTutorTurn = useCallback(async (isGiveUp: boolean) => {
    if (selectedId == null) return;
    // Duplicate guard (same rule as Streamlit): same (qid, sql, gaveUp)
    // within 1.5 s is ignored without an API call.
    const sig = JSON.stringify([selectedId, currentDraft.trim(), isGiveUp]);
    const now = performance.now();
    const prev = lastSubmitSigRef.current;
    if (prev !== null && prev.sig === sig && now - prev.ts < DUPLICATE_WINDOW_MS) {
      setDuplicate(true);
      return;
    }
    setDuplicate(false);
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

      // Append to activity log — EXACT match to Streamlit's activity_log keys
      const newEntry: ActivityEntry = {
        qid: selectedId,
        title: metaData?.questions.find((q) => q.id === selectedId)?.question ?? "",
        correct: data.tool_result.correct,
        attempt: data.attempt,
        hint_level: data.tool_result.hint_level,
        gave_up: data.tool_result.gave_up,
        timestamp: new Date().toISOString().slice(0, 19), // ISO-8601 seconds
      };
      addEntry(newEntry);

      // Increment attempt counter
      setAttempts((prev) => ({ ...prev, [selectedId]: data.attempt }));
      // Record signature only after success (mirrors Streamlit: a failed turn
      // clears the signature so an immediate retry is never blocked).
      lastSubmitSigRef.current = { sig, ts: performance.now() };
    } catch (err) {
      lastSubmitSigRef.current = null;
      const message = err instanceof Error ? err.message : "Unknown error";
      const isNetwork = message.startsWith("HTTP 0") || message.includes("fetch");
      setError({
        message: isNetwork
          ? "Cannot reach the tutor service. Make sure the backend is running: `uvicorn app_main:app --port 8000`"
          : message,
        canRetry: true,
        retryAction: () => executeTutorTurnRef.current?.(isGiveUp),
      });
    } finally {
      setPending(false);
    }
  }, [selectedId, currentDraft, attempts, metaData, addEntry]);

  // Keep ref updated
  useEffect(() => {
    executeTutorTurnRef.current = executeTutorTurn;
  }, [executeTutorTurn]);

  // --- Handle Submit SQL ---
  const handleSubmit = useCallback(() => executeTutorTurn(false), [executeTutorTurn]);

  // --- Handle Give Up ---
  const handleGiveUp = useCallback(() => executeTutorTurn(true), [executeTutorTurn]);

  // --- Render ---
  if (loadError) {
    return (
      <div className="p-8">
        <PageHeader
          eyebrow="Learn"
          title="The workspace could not load"
          description="Question metadata comes from the FastAPI backend. Nothing else on this page depends on it."
        />
        <Panel className="flex flex-col gap-3 p-6">
          <p className="text-sm text-error">{loadError}</p>
          <p className="text-sm text-muted">
            Start the backend with{" "}
            <code className="font-mono text-xs">uvicorn app_main:app --port 8000</code> from the
            repository root, then reload.
          </p>
        </Panel>
      </div>
    );
  }

  if (!metaData) {
    return (
      <div className="p-8">
        <PageHeader eyebrow="Learn" title="Loading workspace…" />
        <Panel className="flex flex-col gap-3 p-6">
          <p className="text-sm text-muted">Fetching question metadata from the backend.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div data-testid="learn-workspace">
      <PageHeader
        eyebrow="Learn"
        title="Practice the questions"
        description="One checker run and one tutor reply per submission. Your SQL is never modified by the tutor."
      />

      <div className="flex flex-col sm:flex-row gap-3 sm:items-start sm:gap-10">
        <QuestionHeader
          meta={meta}
          selectedId={selectedId}
          onSelect={handleQuestionSelect}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left column: editor + actions */}
        <Panel className="flex flex-col gap-4 p-5 sm:p-6 lg:col-span-7">
          <p className="eyebrow">SQL editor</p>

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
          />
        </Panel>

        {/* Right column: schema + tutor */}
        <Panel className="flex flex-col gap-3 p-5 sm:p-6 lg:col-span-5">
          <p className="eyebrow">Database schema</p>
          <SchemaPanel />
        </Panel>

        <Panel className="flex flex-col gap-3 p-5 sm:p-6 lg:col-span-5">
          <TutorPanel
            toolResult={tutorResult}
            reply={reply}
            hintLevel={hintLevel}
            gaveUp={gaveUp}
            earlierAttempts={activityLog
              .filter((e) => e.qid === selectedId)
              .map((e) => ({
                attempt: e.attempt,
                correct: e.correct,
                reason: e.gave_up ? "gave up" : undefined,
                hintLevel: e.hint_level ?? undefined,
                gaveUp: e.gave_up,
              }))}
          />
        </Panel>
      </div>

      <div className="mt-10">
        <SectionHead>How correctness is decided</SectionHead>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
          Every submission is executed by Python against the practice database and compared
          with a reference result. The language model never decides whether your SQL is
          correct, and it only sees the checker details that the current hint level allows.
        </p>
      </div>
    </div>
  );
}