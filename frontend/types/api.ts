/**
 * Typed mirrors of the Phase 1 FastAPI contracts (`MIGRATION_PLAN.md` §6).
 *
 * Phase 2 only calls E1 (health) and E2 (meta). The remaining shapes are
 * declared so the frontend contract stays in one place, but no request
 * functions exist for them yet: the SQL editor, tutor turn and Progress
 * metrics belong to Phases 3–5.
 */

export type Health = {
  status: string;
  db_configured: boolean;
  llm_configured: boolean;
};

export type QuestionMeta = {
  id: number;
  purpose: "practice" | "held_out";
  question: string;
};

export type Meta = {
  questions: QuestionMeta[];
  practice_ids: number[];
  held_ids: number[];
  reason_labels: Record<string, string>;
};

export type TutorTurnRequest = {
  question_id: number;
  learner_sql: string;
  attempt_number: number;
  gave_up: boolean;
  history: unknown[];
  submission_token?: string;
};

export type ToolResult = {
  correct: boolean;
  reason: string;
  reason_label: string;
  row_diff: [number, number];
  hint_level: number;
  gave_up: boolean;
  learner_rows?: unknown[][];
};

export type TutorTurn = {
  reply: string;
  history: unknown[];
  attempt: number;
  tool_result: ToolResult;
};