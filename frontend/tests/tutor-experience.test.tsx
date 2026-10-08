import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LearnView } from "@/components/learn/LearnView";
import { TutorPanel } from "@/components/learn/TutorPanel";
import { ActivityProvider } from "@/lib/activity-context";
import { ThemeProvider } from "@/lib/theme";
import type { Meta, ToolResult } from "@/types/api";

// Same harness as submission-states/attempt-number: Monaco cannot run in
// jsdom, and SchemaPanel would issue its own fetch.
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
vi.mock("monaco-editor", () => ({}));
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

/** Backend-shaped tool_result (app_main.ToolResultOut). */
function toolResult(over: Partial<ToolResult> = {}): ToolResult {
  return {
    correct: false,
    reason: "row_count",
    reason_label: "Different number of rows",
    row_diff: [1, 2],
    hint_level: 1,
    gave_up: false,
    learner_rows: [],
    ...over,
  };
}

function turnResponse(opts: {
  correct?: boolean;
  attempt: number;
  hint_level?: number;
  gave_up?: boolean;
  reason_label?: string;
  reply?: string;
}) {
  const { correct = false, attempt, hint_level = 1, gave_up = false } = opts;
  return {
    ok: true,
    json: async () => ({
      reply:
        opts.reply ??
        (correct
          ? "That matches the reference result."
          : "Focus on the WHERE clause."),
      history: [],
      attempt,
      tool_result: toolResult({
        correct,
        reason: correct ? "ok" : "row_count",
        reason_label: opts.reason_label ?? (correct ? "the result matches the expected answer" : "Different number of rows"),
        hint_level,
        gave_up,
      }),
    }),
  };
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  suffix: string,
): Promise<void> {
  await user.type(screen.getByTestId("sql-input"), suffix);
  await user.click(screen.getByRole("button", { name: "Submit SQL" }));
}

/** Direct render — presentation-only tests that need no page flow. */
function renderTutor(props: Partial<React.ComponentProps<typeof TutorPanel>> = {}) {
  return render(
    <TutorPanel
      toolResult={null}
      reply={null}
      hintLevel={null}
      earlierAttempts={[]}
      {...props}
    />,
  );
}

describe("Tutor experience (learner-facing)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Requirement 1 — idle must not expose internal state.
  it("idle: calm empty state, no 'Attempt 0 · no hint', no hint context", () => {
    renderLearn();

    expect(screen.getByTestId("tutor-idle")).toBeInTheDocument();
    expect(screen.getByText(/Check your SQL to get the checker/)).toBeInTheDocument();
    expect(screen.queryByTestId("turn-meta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Attempt 0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no hint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hint context/)).not.toBeInTheDocument();
  });

  // Requirement 2 — incorrect: verdict + plain reason + tutor guidance.
  it("incorrect: verdict, plain-language reason, and tutor guidance", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(turnResponse({ attempt: 1 }));

    renderLearn();
    await submit(user, "SELECT 13;");
    await screen.findByTestId("tutor-status");

    const status = screen.getByTestId("tutor-status");
    expect(status).toHaveTextContent(/^Not quite/);
    expect(status).toHaveTextContent("Different number of rows");
    expect(screen.getByTestId("tutor-reply")).toHaveTextContent(
      "Focus on the WHERE clause.",
    );
    expect(screen.getByTestId("turn-meta")).toHaveTextContent(/^Attempt 1$/);
  });

  // Requirement 3 — hint implementation language never renders; hint_level
  // only selects learner-facing phrasing.
  it("hint levels render as guidance phrases, never as implementation language", () => {
    const phrases = [
      "A small nudge",
      "A stronger clue",
      "Here's the key idea",
      "The full solution",
    ];
    for (let level = 1; level <= 4; level++) {
      const view = renderTutor({
        toolResult: toolResult({ hint_level: level }),
        reply: "Tutor guidance.",
        hintLevel: level,
      });
      expect(screen.getByTestId("guidance-phrase")).toHaveTextContent(
        phrases[level - 1],
      );
      const panel = screen.getByTestId("tutor-panel");
      expect(panel).not.toHaveTextContent(/hint level/i);
      expect(panel).not.toHaveTextContent("of 4");
      view.unmount();
    }
  });

  // Requirement 4 — raw hint-context JSON stays out of the learner path.
  it("does not render hint-context JSON or 'model saw' payloads", () => {
    renderTutor({
      toolResult: toolResult({ hint_level: 3, row_diff: [4, 7] }),
      reply: "Compare the row counts.",
      hintLevel: 3,
    });

    const panel = screen.getByTestId("tutor-panel");
    expect(panel).not.toHaveTextContent(/Hint context/);
    expect(panel).not.toHaveTextContent(/\{"correct"/);
    expect(panel).not.toHaveTextContent(/Model/);
    expect(panel).not.toHaveTextContent("hint_level");
    expect(panel).not.toHaveTextContent("row_diff");
    // The learner still gets the verdict, reply and guidance phrase.
    expect(panel).toHaveTextContent(/^Not quite/);
    expect(panel).toHaveTextContent("Compare the row counts.");
    expect(panel).toHaveTextContent("Here's the key idea");
  });

  // Requirement 5 — earlier attempts remain, as supporting history.
  it("earlier attempts stay available as plain-language supporting history", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(turnResponse({ attempt: 1 }))
      .mockResolvedValueOnce(turnResponse({ attempt: 2, hint_level: 2 }));

    renderLearn();
    await submit(user, "SELECT 13;");
    await waitFor(() =>
      expect(screen.getByTestId("turn-meta")).toHaveTextContent(/^Attempt 1$/),
    );

    await submit(user, "SELECT 14;");
    await waitFor(() =>
      expect(screen.getByTestId("turn-meta")).toHaveTextContent(/^Attempt 2$/),
    );

    expect(screen.getByText("Earlier attempts (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Attempt 1 · Not quite · A small nudge"),
    ).toBeInTheDocument();
    // The current turn is not listed as an earlier attempt, and the rows
    // carry no internal reason codes or raw JSON.
    expect(screen.queryByText(/^Attempt 2 ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/row_count/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\{"correct"/)).not.toBeInTheDocument();
  });

  // Requirement 6 — gave up: exactly one learner-facing statement.
  it("Give Up shows a single gave-up state with the solution under it", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      turnResponse({
        attempt: 1,
        hint_level: 4,
        gave_up: true,
        reply: "The reference answer is:\n```sql\nSELECT 1;\n```",
      }),
    );

    renderLearn();
    await user.click(screen.getByRole("button", { name: "Give Up" }));

    expect(await screen.findByTestId("tutor-gave-up")).toHaveTextContent(
      "Reference solution revealed",
    );
    // The verdict is replaced, not stacked, on the give-up turn.
    expect(screen.queryByTestId("tutor-status")).not.toBeInTheDocument();
    // The two legacy gave-up notes and the meta suffix are gone.
    expect(
      screen.queryByText(/reference SQL is now disclosed/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Selecting Give Up disclosed/i),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("turn-meta")).not.toHaveTextContent(/gave up/i);
    // Exactly one gave-up statement inside the tutor panel (the ActionBar
    // Give Up button lives outside it).
    const panel = screen.getByTestId("tutor-panel");
    expect(
      panel.textContent?.match(/give up/gi) ?? [],
    ).toHaveLength(1);
    // The disclosed solution renders as the reference-solution content.
    expect(screen.getByText("Reference solution")).toBeInTheDocument();
    expect(
      screen.getByTestId("tutor-reply").querySelector("code"),
    ).toHaveTextContent("SELECT 1;");
  });

  // Requirement 7 — tutor content cannot inject arbitrary HTML.
  it("renders model HTML as literal text — no elements, no execution", () => {
    const { container } = renderTutor({
      toolResult: toolResult({ correct: true, hint_level: 0 }),
      reply:
        '<img src="x" onerror="window.__x=1"> <script>window.__y=1</script> **<b onclick="window.__z=1">bold</b>**',
      hintLevel: 0,
    });

    const reply = screen.getByTestId("tutor-reply");
    expect(reply).toHaveTextContent('<img src="x" onerror="window.__x=1">');
    expect(reply).toHaveTextContent("<script>window.__y=1</script>");
    // Markdown emphasis still works — as elements we create, containing the
    // model's markup as escaped text.
    const strong = reply.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('<b onclick="window.__z=1">bold</b>');
    expect(reply.querySelector("img")).toBeNull();
    expect(reply.querySelector("script")).toBeNull();
    expect(reply.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  // Requirement 8 — correct state renders as a connected result.
  it("correct: verdict with confirmation, tutor content, no guidance phrase", () => {
    renderTutor({
      toolResult: toolResult({
        correct: true,
        reason: "ok",
        reason_label: "the result matches the expected answer",
        hint_level: 0,
      }),
      reply: "Exactly right — you filtered on city.",
      hintLevel: 0,
    });

    const status = screen.getByTestId("tutor-status");
    expect(status).toHaveTextContent(/^Correct/);
    expect(status).toHaveTextContent("the result matches the expected answer");
    expect(screen.getByTestId("tutor-reply")).toHaveTextContent(
      "Exactly right — you filtered on city.",
    );
    expect(screen.getByTestId("turn-meta")).toHaveTextContent(/^Attempt 1$/);
    expect(screen.queryByTestId("guidance-phrase")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-gave-up")).not.toBeInTheDocument();
  });
});
