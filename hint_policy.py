
MAX_ATTEMPTS = 4


def next_hint_level(
    attempt_number: int,
    correct: bool,
    gave_up: bool = False
) -> int:

    if correct:
        return 0

    if gave_up:
        return 4

    if attempt_number <= 1:
        return 1

    if attempt_number == 2:
        return 2

    if attempt_number == 3:
        return 3

    return 4


def tool_context_for_level(level: int, checker_result: dict) -> dict:
    """Control what checker information the AI receives."""

    if level == 0:
        return {"correct": True}

    if level == 1:
        return {"correct": False}

    if level == 2:
        return {
            "correct": False,
            "reason": checker_result["reason"],
        }

    if level == 3:
        return {
            "correct": False,
            "reason": checker_result["reason"],
            "learner_rows": checker_result["learner_rows"],
        }

    if level == 4:
        return {
            "correct": False,
            "reason": checker_result["reason"],
            "learner_rows": checker_result["learner_rows"],
        }

    raise ValueError("Hint level must be between 0 and 4")
