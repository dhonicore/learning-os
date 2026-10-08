"use client";

import { useMemo } from "react";
import type { Meta } from "@/types/api";
import { useActivity, type ActivityEntry } from "@/lib/activity-context";

import { PageHeader, Panel, SectionHead } from "@/components/ui/primitives";

/** Format timestamp as HH:MM:SS. */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

/** Render activity list (newest first). */
function renderActivityList(entries: ActivityEntry[]): React.ReactNode {
  if (!entries.length) return null;

  return (
    <div className="act-list rounded-ctl border border-line bg-surface p-4">
      {entries.map((entry, i) => {
        const time = formatTime(entry.timestamp);
        const result = entry.correct ? "Correct" : "Incorrect";
        const tagCls = entry.correct ? "tag-ok" : "tag-miss";
        const hint = entry.hint_level !== null ? String(entry.hint_level) : "?";
        let meta = `attempt ${entry.attempt} · hint ${hint}`;
        if (entry.gave_up) meta += " · gave up";

        return (
          <div key={i} className={i === entries.length - 1 ? "act-row border-0" : "act-row"}>
            <span className="act-time">{time}</span>
            <span className="act-q">Q{entry.qid} · {entry.title}</span>
            <span className={tagCls === "tag-ok" ? "tag-ok font-semibold" : "tag-miss font-semibold"}>{result}</span>
            <span className="act-meta">{meta}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Render a single question item for Needs another look / Not yet attempted. */
function renderQuestionItem(
  qid: number,
  title: string,
  metaText: string
): React.ReactNode {
  return (
    <div className="py-1.5 font-mono text-sm text-muted">
      <strong>Q{qid}</strong> · {title} — {metaText}
    </div>
  );
}

/** Stat card component (matches Streamlit's _stat_html). */
function StatCard({ value, label, testId }: { value: string; label: string; testId: string }) {
  return (
    <div className="stat rounded-ctl border border-line bg-surface p-4 min-w-[9rem]" data-testid={testId}>
      <div className="stat-value font-mono text-2xl font-semibold text-ink">{value}</div>
      <div className="stat-label eyebrow">{label}</div>
    </div>
  );
}

interface ProgressPageProps {
  meta: Meta | null;
}

/** Progress page — derives everything from the session activity log.
 *
 *  Mirrors Streamlit's `render_progress` exactly:
 *  - Four metrics: Questions attempted, Solved, Submissions, Not yet attempted
 *  - Recent activity timeline (newest first)
 *  - Needs another look (attempted but unsolved)
 *  - Not yet attempted
 *  - Session-only caption
 *  - Empty state when no submissions
 */
export function ProgressView({ meta }: ProgressPageProps) {
  const { activityLog } = useActivity();

  // Derive all metrics from the log — EXACT match to Streamlit's formulas
  const log = useMemo(
    () => [...activityLog].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [activityLog]
  );

  const solvedIds = useMemo(() => new Set(log.filter((r) => r.correct).map((r) => r.qid)), [log]);
  const attemptedIds = useMemo(() => new Set(log.map((r) => r.qid)), [log]);

  const questions = useMemo(() => meta?.questions ?? [], [meta]);
  const totalQuestions = useMemo(() => questions.length, [questions]);

  const attempted = useMemo(
    () => questions.filter((q) => attemptedIds.has(q.id)),
    [questions, attemptedIds]
  );
  const unsolved = useMemo(
    () => attempted.filter((q) => !solvedIds.has(q.id)),
    [attempted, solvedIds]
  );
  const notAttempted = useMemo(
    () => questions.filter((q) => !attemptedIds.has(q.id)),
    [questions, attemptedIds]
  );

  const stats = useMemo(() => ({
    attempted: attempted.length,
    solved: solvedIds.size,
    submissions: log.length,
    notAttempted: notAttempted.length,
    total: totalQuestions,
  }), [attempted.length, solvedIds.size, log.length, notAttempted.length, totalQuestions]);

  return (
    <>
      <PageHeader
        eyebrow="Progress"
        title="This session so far"
        description="Session-only: this page reflects submissions in this browser — a refresh starts over."
      />

      {/* Four metric cards — matches Streamlit's summary-card layout */}
      <Panel className="grid grid-cols-2 divide-x divide-line overflow-hidden lg:grid-cols-4 rounded-ctl border border-line bg-surface">
        <StatCard value={`${stats.attempted} of ${stats.total}`} label="Questions attempted" testId="stat-attempted" />
        <StatCard value={`${stats.solved} of ${stats.total}`} label="Solved" testId="stat-solved" />
        <StatCard value={`${stats.submissions}`} label="Submissions" testId="stat-submissions" />
        <StatCard value={`${stats.notAttempted}`} label="Not yet attempted" testId="stat-not-attempted" />
      </Panel>

      <div className="mt-4 text-xs text-muted">
        Attempted = at least one processed submission · Solved = at least one checker-confirmed correct submission ·
        Failed requests are not counted.
      </div>

      {/* Recent activity */}
      <SectionHead>Recent activity</SectionHead>
      {log.length === 0 ? (
        <Panel className="p-5 sm:p-6 text-center">
          <p className="text-muted">
            No submissions yet. Check answer in the Learn workspace to see attempted and solved questions here.
            Progress is session-only.
          </p>
        </Panel>
      ) : (
        renderActivityList(log)
      )}

      {/* Needs another look */}
      {unsolved.length > 0 && (
        <>
          <SectionHead>Needs another look</SectionHead>
          <Panel className="rounded-ctl border border-line bg-surface/50 p-4 bg-raised">
            {unsolved.map((q) => {
              const recs = log.filter((r) => r.qid === q.id);
              const lastHint = recs[0]?.hint_level ?? null;
              const plural = recs.length === 1 ? "" : "s";
              const hintText = lastHint !== null ? String(lastHint) : "?";
              return renderQuestionItem(
                q.id,
                q.question,
                `${recs.length} attempt${plural}, last hint level ${hintText}`
              );
            })}
          </Panel>
        </>
      )}

      {/* Not yet attempted */}
      {notAttempted.length > 0 && (
        <>
          <SectionHead>Not yet attempted</SectionHead>
          <Panel className="rounded-ctl border border-line bg-surface/50 p-4 bg-raised">
            {notAttempted.map((q) =>
              renderQuestionItem(q.id, q.question, "No submissions yet")
            )}
          </Panel>
        </>
      )}
    </>
  );
}