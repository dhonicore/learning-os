
import json
import os

from dotenv import load_dotenv
from groq import Groq
from questions import QUESTIONS
from tools import execute_tool
from hint_policy import next_hint_level, tool_context_for_level
from tools import execute_tool
from hint_policy import next_hint_level, tool_context_for_level
from questions import QUESTIONS


# --------------------------------------------------
# Configuration
# --------------------------------------------------

load_dotenv()

client = Groq(api_key=os.environ["GROQ_API_KEY"])

MODEL = "openai/gpt-oss-120b"


# --------------------------------------------------
# System Prompt
# --------------------------------------------------

SYSTEM_PROMPT = """
You are a SQL tutor for beginners.

Your job is to guide students toward understanding SQL.

GENERAL RULES:
- Never judge SQL correctness yourself.
- The application has already executed the learner's SQL and provides a
  structured verification result with each attempt.
- Base every statement about correctness only on that verification result.
- Never invent database tables, columns, values, or expected results.
- Use simple language.
- Explain one idea at a time.
- Ask a guiding question when appropriate.

HINT LEVEL RULES:

Level 0:
- The learner's answer is correct.
- Congratulate the learner.
- Explain briefly what they accomplished.
- Do not reveal reference SQL.
- Do not provide unnecessary hints.

Level 1:
- You only know that the answer is incorrect.
- Give a conceptual nudge.
- Do not invent a specific reason.
- Do not reveal a corrected query.

Level 2:
- You may use the checker reason.
- Explain the general type of mistake.
- Do not reveal the full solution.

Level 3:
- You may use the learner's actual output and row-count information.
- Explain what the output tells us.
- Do not reveal the reference SQL.

Level 4:
- If reference_sql is provided, reveal it.
- Explain the reference query in beginner-friendly language.
- Explain how it solves the question.

IMPORTANT:
Only use information provided in the question, schema,
learner's SQL, and filtered checker result.

Never pretend to know information that was not provided.
"""


# --------------------------------------------------
# Tutor Turn
# --------------------------------------------------

def run_tutor_turn(
    question_id: int,
    question_text: str,
    schema_hint: str,
    learner_sql: str,
    history: list,
    attempt_number: int,
    gave_up: bool = False,
) -> tuple[str, list, dict]:

    """
    Returns:
        assistant_text,
        updated_history,
        last_tool_result  (checker result plus "hint_level" — the level
                          Python's hint policy computed for this turn)
    """

    # 1. Python runs the checker first. The model is never asked to.

    tool_result = execute_tool(
        "check_sql",
        {"question_id": question_id, "sql": learner_sql},
    )

    # 2. Decide the permitted hint level

    level = next_hint_level(
        attempt_number=attempt_number,
        correct=tool_result["correct"],
        gave_up=gave_up,
    )

    # 3. Filter checker information

    # Some checker outcomes, such as SQL errors,
    # don't contain learner_rows or reference_sql.

    policy_input = {
        **tool_result,
        "learner_rows": tool_result.get("learner_rows", []),
        "reference_sql": tool_result.get("reference_sql"),
    }

    trimmed = tool_context_for_level(
        level,
        policy_input,
    )

    if level == 4:
        trimmed["reference_sql"] = QUESTIONS[question_id]["reference_sql"]

    # Level 3 and 4 can use row-count information.

    if level >= 3:
        trimmed["row_diff"] = tool_result.get("row_diff")

    # Never send an absent reference solution.

    if not trimmed.get("reference_sql"):
        trimmed.pop("reference_sql", None)

    # Tell the model which hint level is active.

    trimmed["hint_level"] = level

    print(
        f"[DEBUG] Hint level: {level}",
        flush=True,
    )

    print(
        f"[DEBUG] Filtered context: {trimmed}",
        flush=True,
    )

    # 4. Build the current user message, including the verified context

    user_content = (
        f"Question #{question_id}: {question_text}\n\n"
        f"Schema: {schema_hint}\n\n"
        f"Learner's SQL attempt:\n{learner_sql}\n\n"
        f"Verification result:\n{json.dumps(trimmed)}"
    )

    # 5. Preserve conversation order:
    # system -> previous conversation -> current attempt

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": user_content},
    ]

    # 6. One model call. No tools: Python already owns correctness.

    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
    )

    assistant_text = response.choices[0].message.content or ""

    updated_history = history + [
        {"role": "user", "content": user_content},
        {"role": "assistant", "content": assistant_text},
    ]

    return assistant_text, updated_history, {**tool_result, "hint_level": level}
