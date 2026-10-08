import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LearnView } from "@/components/learn/LearnView";
import { ActivityProvider } from "@/lib/activity-context";
import { ThemeProvider } from "@/lib/theme";
import type { Meta } from "@/types/api";

// Monaco + schema panel mocked out (same harness as submission-states tests).
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

/** Successful tutor turn carrying the backend's attempt number (source of truth). */
function turn(attempt: number) {
  return {
    ok: true,
    json: async () => ({
      reply: "Tutor reply.",
      history: [],
      attempt,
      tool_result: {
        correct: false,
        reason: "row_count",
        reason_label: "Different number of rows",
        row_diff: [1, 2] as [number, number],
        hint_level: 1,
        gave_up: false,
      },
    }),
  };
}

function renderLearn() {
  return render(
    <ThemeProvider>
      <ActivityProvider>
        <LearnView meta={META} loadError={null} />
      </ActivityProvider>
    </ThemeProvider>,
  );
}

const turnMeta = () => screen.getByTestId("turn-meta");

/** Submit the current draft. Each call appends `suffix` so the 1.5 s
    duplicate guard (same qid+sql) never swallows a follow-up turn. */
async function submit(
  user: ReturnType<typeof userEvent.setup>,
  suffix: string,
): Promise<void> {
  await user.type(screen.getByTestId("sql-input"), suffix);
  await user.click(screen.getByRole("button", { name: "Submit SQL" }));
}

describe("Attempt number display (current turn not double-counted)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows Attempt 1 after the first submission (idle shows no attempt meta)", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(turn(1));

    renderLearn();
    // Learner-facing tutor experience: idle renders the calm empty state —
    // no "Attempt 0 · no hint" internal-state meta.
    expect(screen.queryByTestId("turn-meta")).not.toBeInTheDocument();
    expect(screen.queryByText(/Attempt 0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no hint/i)).not.toBeInTheDocument();

    await submit(user, "SELECT 1;");
    await screen.findByTestId("tutor-status");

    // Requirement 1: first submission → Attempt 1 (was "Attempt 2" because
    // earlierAttempts already held the current turn and turnMeta added 1).
    expect(turnMeta()).toHaveTextContent(/^Attempt 1$/);
    expect(turnMeta()).not.toHaveTextContent("Attempt 2");
    // The current attempt is also not listed as an *earlier* attempt.
    expect(screen.queryByText(/Earlier attempts/)).not.toBeInTheDocument();
  });

  it("shows Attempt 2 after the second submission, listing only attempt 1 as earlier", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(turn(1)).mockResolvedValueOnce(turn(2));

    renderLearn();
    await submit(user, "SELECT 1;");
    await waitFor(() => expect(turnMeta()).toHaveTextContent(/^Attempt 1$/));

    await submit(user, " 2");

    // Requirement 2: second submission → Attempt 2.
    await waitFor(() => expect(turnMeta()).toHaveTextContent(/^Attempt 2$/));
    expect(turnMeta()).not.toHaveTextContent("Attempt 3");

    // Earlier attempts = prior turns only: exactly attempt 1, not attempt 2.
    expect(screen.getByText("Earlier attempts (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Attempt 1 · Not quite · A small nudge"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Attempt 2 ·/)).not.toBeInTheDocument();
  });

  it("keeps counting once per submission: Attempt 3 after the third, earlier list holds 1 and 2", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(turn(1))
      .mockResolvedValueOnce(turn(2))
      .mockResolvedValueOnce(turn(3));

    renderLearn();
    await submit(user, "SELECT 1;");
    await waitFor(() => expect(turnMeta()).toHaveTextContent(/^Attempt 1$/));

    await submit(user, " 2");
    await waitFor(() => expect(turnMeta()).toHaveTextContent(/^Attempt 2$/));

    await submit(user, " 3");

    // Requirement 3 (sequence): every submission increments by exactly one.
    await waitFor(() => expect(turnMeta()).toHaveTextContent(/^Attempt 3$/));
    expect(turnMeta()).not.toHaveTextContent("Attempt 4");

    expect(screen.getByText("Earlier attempts (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Attempt 1 · Not quite · A small nudge"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Attempt 2 · Not quite · A small nudge"),
    ).toBeInTheDocument();
    // The current (third) attempt never appears in the earlier-attempts list.
    expect(screen.queryByText(/^Attempt 3 ·/)).not.toBeInTheDocument();
  });
});
