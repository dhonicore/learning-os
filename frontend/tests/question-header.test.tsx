import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QuestionHeader } from "@/components/learn/QuestionHeader";
import type { Meta } from "@/types/api";

const META: Meta = {
  questions: [
    { id: 1, purpose: "practice", question: "List all customers from Bengaluru." },
    { id: 2, purpose: "practice", question: "How many orders are there in total?" },
  ],
  practice_ids: [1, 2],
  held_ids: [],
  reason_labels: {},
};

describe("QuestionHeader (question text)", () => {
  it("renders the selected question's actual text, not just its number", () => {
    render(<QuestionHeader meta={META} selectedId={1} onSelect={() => {}} />);

    expect(screen.getByTestId("question-text")).toHaveTextContent(
      "List all customers from Bengaluru.",
    );
  });

  it("updates the rendered text when the learner selects another question", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<QuestionHeader meta={META} selectedId={1} onSelect={onSelect} />);

    await user.click(screen.getByTestId("qnav-Q2"));
    expect(onSelect).toHaveBeenCalledWith(2);

    rerender(<QuestionHeader meta={META} selectedId={2} onSelect={onSelect} />);
    expect(screen.getByTestId("question-text")).toHaveTextContent(
      "How many orders are there in total?",
    );
  });

  it("renders the question as the top-level heading (Slice A: question-first)", () => {
    render(<QuestionHeader meta={META} selectedId={1} onSelect={() => {}} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "List all customers from Bengaluru." }),
    ).toBeInTheDocument();
  });

  it("keeps navigation context to a single identity line with no duplicated Learn label", () => {
    render(<QuestionHeader meta={META} selectedId={1} onSelect={() => {}} />);

    // The identity line is split across text nodes, so match on textContent.
    expect(
      screen.getByText(
        (_, element) => element?.textContent === "Question 1 of 2 · Practice",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Learn")).not.toBeInTheDocument();
  });
});
