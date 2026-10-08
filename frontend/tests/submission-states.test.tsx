import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LearnView } from "@/components/learn/LearnView";
import { ActivityProvider } from "@/lib/activity-context";
import { ThemeProvider } from "@/lib/theme";
import type { Meta } from "@/types/api";

// Monaco loads from a CDN and `monaco-editor` cannot run under jsdom; the
// editor is replaced by a textarea that forwards edits the same way the real
// component does (second argument truthy, so SqlEditor's null guard passes).
vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (value?: string, editor?: unknown) => void;
  }) => (
    <textarea
      data-testid="sql-input"
      aria-label="SQL"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value, {})}
    />
  ),
}));

// Imported by SqlEditor for types only.
vi.mock("monaco-editor", () => ({}));

// SchemaPanel would issue its own /api/schema fetch; irrelevant here and it
// would pollute the request counts these tests assert on.
vi.mock("@/components/learn/SchemaPanel", () => ({ SchemaPanel: () => null }));

const META: Meta = {
  questions: [{ id: 1, purpose: "practice", question: "List all customers from Bengaluru." }],
  practice_ids: [1],
  held_ids: [],
  reason_labels: {},
};

const fetchMock = vi.fn();

function renderLearn() {
  return render(
    <ThemeProvider>
      <ActivityProvider>
        <LearnView meta={META} loadError={null} />
      </ActivityProvider>
    </ThemeProvider>,
  );
}

/** Shape of a successful POST /api/tutor/turn response. */
function turnResponse(opts: { correct: boolean; attempt: number; reply?: string }) {
  const { correct, attempt, reply } = opts;
  return {
    ok: true,
    json: async () => ({
      reply: reply ?? (correct ? "That matches the reference result." : "Row counts differ."),
      history: [],
      attempt,
      tool_result: {
        correct,
        reason: correct ? "ok" : "row_count",
        reason_label: correct ? "Match" : "Different number of rows",
        row_diff: correct ? ([0, 0] as [number, number]) : ([1, 2] as [number, number]),
        hint_level: 1,
        gave_up: false,
      },
    }),
  };
}

/** Shape of a failed response (LearnView reads .text(), not .json()). */
function errorResponse(status: number, text: string) {
  return { ok: false, status, text: async () => text };
}

async function typeSql(user: ReturnType<typeof userEvent.setup>, sql: string) {
  await user.type(screen.getByTestId("sql-input"), sql);
}

describe("Submission states (Slice B): idle → Checking… → outcome", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces Checking… while a turn is in flight, disables both actions, and issues one request", async () => {
    const user = userEvent.setup();
    let resolveTurn!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveTurn = resolve)));

    renderLearn();

    // Idle: no status line; Submit disabled only because the SQL is empty.
    expect(screen.getByTestId("submit-status")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("submit-status")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Check answer" })).toBeDisabled();
    expect(screen.getByTestId("give-up")).toBeEnabled();

    await typeSql(user, "SELECT 1;");
    expect(screen.getByRole("button", { name: "Check answer" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Check answer" }));

    // Checking: label swap, live region, both buttons disabled, SQL untouched.
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.getByTestId("give-up")).toBeDisabled();
    expect(screen.getByTestId("submit-status")).toHaveTextContent("Checking your query…");
    expect(screen.getByTestId("sql-input")).toHaveValue("SELECT 1;");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("/api/tutor/turn");
    expect(JSON.parse(init.body)).toEqual({
      question_id: 1,
      learner_sql: "SELECT 1;",
      history: [],
      attempt_number: 1,
      gave_up: false,
    });

    // A second activation while disabled must not create a second request.
    await user.click(screen.getByRole("button", { name: "Checking…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Resolution moves the interaction to its outcome.
    await act(async () => resolveTurn(turnResponse({ correct: false, attempt: 1 })));
    // The banner carries the verdict word plus its plain-language reason on
    // a separate line ("Not quite" / "Different number of rows") — the
    // anchored regex keeps it from matching a "Correct" assertion elsewhere.
    expect(await screen.findByTestId("tutor-status")).toHaveTextContent(/^Not quite/);
    expect(screen.getByTestId("submit-status")).toHaveTextContent(/^Not quite yet/);
    expect(screen.getByRole("button", { name: "Check answer" })).toBeEnabled();
  });

  it("reports Correct. in the status line after a correct turn", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(turnResponse({ correct: true, attempt: 1 }));

    renderLearn();
    await typeSql(user, "SELECT 1;");
    await user.click(screen.getByRole("button", { name: "Check answer" }));

    expect(await screen.findByTestId("tutor-status")).toHaveTextContent(/^Correct/);
    expect(screen.getByTestId("submit-status")).toHaveTextContent(/^Correct\.$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the 1.5 s duplicate guard: a repeat submission never reaches the API", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(turnResponse({ correct: false, attempt: 1 }));

    renderLearn();
    await typeSql(user, "SELECT 1;");
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(await screen.findByTestId("tutor-status")).toHaveTextContent(/^Not quite/);

    // Same (qid, sql, gaveUp) within the window: ignored before any request.
    await user.click(screen.getByRole("button", { name: "Check answer" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("duplicate-caption")).toHaveTextContent(
      "Duplicate submission ignored",
    );
    // The outcome line still reports the last completed turn — the duplicate
    // click never entered the checking state.
    expect(screen.getByTestId("submit-status")).toHaveTextContent(/^Not quite yet/);
  });

  it("shows errors in role=alert, suppresses the stale outcome line, and Retry issues a fresh request", async () => {
    const user = userEvent.setup();
    let resolveRetry!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(turnResponse({ correct: false, attempt: 1 }))
      .mockResolvedValueOnce(errorResponse(502, "Bad gateway"))
      // Deferred so the checking state is observable; an immediately-resolved
      // promise would race straight past it.
      .mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));

    renderLearn();
    await typeSql(user, "SELECT 1;");
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(await screen.findByTestId("tutor-status")).toHaveTextContent(/^Not quite/);
    expect(screen.getByTestId("submit-status")).toHaveTextContent(/^Not quite yet/);

    // Change the SQL so the 1.5 s signature differs, then fail the turn.
    await typeSql(user, " 2");
    await user.click(screen.getByRole("button", { name: "Check answer" }));

    const alert = await screen.findByRole("alert");
    // Friendly, learner-facing copy: no raw status codes or commands.
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("The tutor service returned an error. Please wait a moment and try again.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByTestId("tutor-panel")).not.toBeInTheDocument();
    // While the alert owns the moment the outcome line stays silent.
    expect(screen.getByTestId("submit-status")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Check answer" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Checking…" })).not.toBeInTheDocument();

    // Retry re-enters the checking state and clears the alert.
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.getByTestId("submit-status")).toHaveTextContent("Checking your query…");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => resolveRetry(turnResponse({ correct: true, attempt: 2 })));
    await waitFor(() =>
      expect(screen.getByTestId("tutor-status")).toHaveTextContent(/^Correct/),
    );
    expect(screen.getByTestId("submit-status")).toHaveTextContent(/^Correct\.$/);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The failed turn did not consume an attempt: the retry re-sent attempt 2.
    const retryBody = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
    expect(retryBody.attempt_number).toBe(2);
  });
});
