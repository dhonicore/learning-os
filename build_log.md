# Learning OS — Build Log
**Started:** Saturday, October 3, 2026
**Companion to:** `learning_os_capstone_handoff.md`

This file records what was actually built, what broke, what was learned,
and what remains. Update it at the end of every session.

---

## 1. What exists on disk

```
learning-os/
├── .git/                  # git repo (initialized Oct 3)
├── .gitignore             # ignores .venv, .env, __pycache__, etc.
├── .venv/                 # Python virtual environment
├── .env                   # DATABASE_URL, GROQ_API_KEY (NOT committed)
├── app.py                 # empty — Streamlit UI, not yet built
├── tutor.py               # tutor orchestration + Groq loop
├── tools.py               # check_sql tool definition + executor
├── checker.py             # safe SQL execution + result comparison
├── hint_policy.py         # hint level + tool-context trimming
├── database.py            # Supabase connection
├── questions.py           # 8 questions + reference SQL
├── requirements.txt       # psycopg[binary], python-dotenv, groq
├── build_log.md           # this file
└── README.md              # empty — to be written
```

Git commits:
- `fc66d3d` — "Initial skeleton: git, venv, gitignore, stub files"
- (more commits added after this log; see `git log --oneline`)

---

## 2. Database (Supabase Postgres)

### Schema (verified against `information_schema.columns`)

```
customers: id (integer), name (text), city (text)
orders:    id (integer), customer_id (integer),
           order_date (date), amount (integer)
```

### Data (verified by selecting all rows)

8 customers, 14 orders.
- Cities: Bengaluru (Asha, Meera, Dev), Mumbai (Ravi, Sana),
  Delhi (Kiran, Isha), Chennai (Tarun)
- Tarun has **zero orders** — makes Q6 meaningful
- Dates span May–Sep 2026; not all orders are in Jul–Sep window

### Connection

- Stored in `.env` as `DATABASE_URL`
- Uses Supabase pooler string (port 6543)
- `database.py` exposes `get_connection()`

---

## 3. The 8 questions and reference SQL (all verified)

All 8 reference queries were run against the live DB and their outputs
recorded. Results:

| Q | Purpose | Expected result |
|---|---|---|
| 1 | practice | 3 Bengaluru customers: Asha, Meera, Dev |
| 2 | practice | 14 (single value) |
| 3 | practice | total per customer — 7 rows (Tarun excluded, no orders) |
| 4 | practice | customers with >2 orders: Asha (3), Meera (4) |
| 5 | practice | 12 rows (name, amount) in Jul–Sep 2026 |
| 6 | held out | Tarun |
| 7 | held out | avg per city: Mumbai 1800, Delhi 550, Bengaluru 1243.75 (Decimal) |
| 8 | held out | Meera (2 orders in Aug 2026) |

**Known ambiguities to document in README:**
- Q3 uses INNER JOIN, so zero-order customers are excluded. A LEFT JOIN
  version would show Tarun with NULL. Reference uses INNER JOIN.
- Q4 and Q8 ask "which customers" but reference also returns the count.
- Q7 returns `Decimal`; checker normalizes to float, rounded to 6 dp.

---

## 4. Code — what each file does

### `database.py`
```python
load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]
def get_connection(): return psycopg.connect(DATABASE_URL)
```
One place that knows the connection string.

### `questions.py`
Dict `QUESTIONS = {1: {...}, ..., 8: {...}}`. Each entry has
`purpose` ("practice" / "held_out"), `question` (learner-facing text),
`reference_sql`. Must never be shown to the LLM before reveal.

### `checker.py`
Public API: `check_sql(question_id: int, learner_sql: str) -> dict`

Return shape:
```python
{
  "correct": bool,
  "error": str | None,        # SQL error message if any
  "reason": str,              # see reasons below
  "row_diff": (int, int),     # (learner rows, reference rows)
}
```

Reasons: `ok`, `value_mismatch`, `missing_rows`, `extra_rows`,
`shape_mismatch`, `sql_error`, `unsafe`, `unknown_question`,
`reference_error`.

Safety layers:
1. `_is_read_only()` — rejects multi-statements, non-SELECT/WITH
   starts, and forbidden keywords (INSERT, UPDATE, DELETE, DROP,
   ALTER, CREATE, TRUNCATE, GRANT, REVOKE, COPY, CALL, DO) anywhere
   in the string.
2. `conn.rollback()` runs after every query, including SELECTs.

Comparison method:
- Rows compared as a `Counter` of tuples → **multiset**, so
  `[1,1,2] ≠ [1,2]` and row order doesn't matter.
- `Decimal` normalized to `float`, floats rounded to 6 dp.
- Column count mismatch detected first via shape check.

### `tools.py`
```python
CHECK_SQL_TOOL = {
  "type": "function",
  "function": {
    "name": "check_sql",
    "description": "...does NOT return the expected answer...",
    "parameters": {
      "question_id": {...},
      # NOTE: sql param removed from schema — model kept inventing it
    }
  }
}
def execute_tool(name, arguments): ...
```

### `hint_policy.py`
```python
MAX_ATTEMPTS = 4

def next_hint_level(attempt_number, correct, gave_up=False) -> int:
    # 0 if correct, 4 if gave_up, else 1/2/3/4 by attempt_number

def tool_context_for_level(level, checker_result) -> dict:
    # level 0/1 → {"correct": ...}
    # level 2   → + reason
    # level 3/4 → + row_diff
    # level 4 reveal handled in tutor.py via system message, not here
```

### `tutor.py`
Orchestrator. Key behaviors:
- `SYSTEM_PROMPT` — role, rules, checker vocabulary, hint rules
- `MAX_TOOL_ROUNDS = 2`
- After the first tool round, `tool_was_called = True` disables further
  tool calls (`tools=None, tool_choice="none"`). Forces plain-text
  response on round 2.
- **Python owns the SQL**: `args["sql"] = learner_sql` overrides
  whatever the model sends.
- `level = next_hint_level(...)` then `tool_context_for_level(...)`
  trims what the model sees before appending to messages.
- At level 4 (wrong), a system message with the reference SQL is
  appended so the model can reveal and explain.

---

## 5. Bugs encountered and fixes

### Bug 1 — pip installed into system Python
**Symptom:** `requirements.txt` listed dozens of packages.
**Cause:** venv wasn't active when `pip install` ran.
**Fix:** `source .venv/bin/activate`, reinstall, `pip freeze > requirements.txt`.
**Rule going forward:** always `which python` before `pip install`.

### Bug 2 — Groq 404: `llama-3.3-70b-versatile` not found
**Cause:** model unavailable on Groq account.
**Fix:** switched to `llama-3.1-8b-instant`.

### Bug 3 — Model rewrote the learner's SQL before checking
**Symptom:** Learner typed `SELECT 13;`, checker reported `correct=True`.
**Cause:** model sent its own invented SQL in the tool call args.
**Fix:** `args["sql"] = learner_sql` in `tutor.py`. Python owns the SQL.
Also removed `sql` from the tool schema so the model has no reason to
send it.

**Lesson:** *Any argument that must be a fact (learner input, IDs,
file paths) should be injected by code, not chosen by the model.*

### Bug 4 — Tool call loop never terminated
**Symptom:** "Let's try that step again." fallback hit every time.
**Cause:** model called `check_sql` on both rounds, never produced text.
**Fix:** after the first tool round, `tools=None, tool_choice="none"`
forces a text response.

### Bug 5 — Model invented a diagnosis from `value_mismatch`
**Symptom:** Tutor said "the checker might expect an alias" / "maybe
there are duplicate rows" — none true.
**Root cause:** `value_mismatch` is vague; the model filled the gap.
**Fix:** built the hint-policy layer. On attempt 1 the model now sees
only `{"correct": false}` — no reason, no diff. Less info → less
invention.
**Lesson:** *When the prompt leaves a gap, the LLM invents. Close gaps
with code, not with more prompt text.*

### Bug 6 — Edits not saved / stale `.pyc`
**Symptom:** `[DEBUG]` prints never appeared after editing `tutor.py`.
**Cause:** `tools.py` edit was never saved; `grep` confirmed.
**Fix:** after every edit, `grep` the file for a unique string to
confirm the save landed. `rm -rf __pycache__` if in doubt.
**Rule:** write → verify on disk → then run.

---

## 6. Key design decisions

- **Comparison is multiset of tuples, not sorted list, not set.**
  Handles duplicates; ignores row order (none of our questions
  require ordering).
- **Checker returns structure, not reference data.** The model sees
  `correct / reason / row_diff`, never the reference rows or SQL.
- **Hint ladder lives in Python, not the prompt.** The model writes
  the hint text; Python decides what it's allowed to know.
- **Reference SQL is injected as a system message at level 4 only.**
  Not smuggled through the tool result.
- **Tool schema declares only `question_id`.** Learner SQL is
  injected by `tutor.py`.
- **No RAG.** Schema is small; putting it in the prompt is simpler
  and sufficient. See handoff §8.6.
- **No FastAPI, no multi-agent.** Streamlit + one tool call is enough.

---

## 7. Current status

**Working:**
- DB connection, schema verified, all 8 reference queries verified
- Checker with safety, comparison, and structured reason codes
- Groq tool calling with a bounded loop
- Python-owned SQL argument (model can't rewrite learner input)
- Hint policy file written and integrated (integration in progress)

**Not yet working / not started:**
- End-to-end test of all 4 hint levels with the new policy
- Streamlit UI (`app.py` is empty)
- Attempt counter + session state (where does `attempt_number` come
  from at runtime? Streamlit session state — not yet built)
- "Give up" button (needs UI)
- Deployment to Hugging Face Spaces
- README, demo video, case study
- Experiment (participants not recruited; likely documented as
  **not run**)

---

## 8. What to do next session

1. Run the 4-attempt test with the new hint policy and paste output.
2. If hints behave, build the Streamlit UI:
   - Question picker
   - SQL input box
   - Submit button (calls `run_tutor_turn`)
   - Chat history display
   - Attempt counter in `st.session_state`
   - "Give up" button
3. Test all 8 questions end to end.
4. Deploy to Hugging Face Spaces.
5. Write README + case study.

---

## 9. Teaching rules I want held in future sessions

(from the handoff, kept here so they don't get lost)

- First principles → plain English → design → small code → run →
  inspect → explain back.
- One small step per response. Never dump full implementations.
- Before every command, explain what and why.
- After every meaningful step, verify on disk (`cat`, `grep`, `ls`).
- If Dhoni can't explain it in simple words, slow down.
- No padding. No repeating what he already knows.
- Don't reopen scope decisions without a real blocker.

---

## 10. Honesty rules

- Experiment status is **not run** unless actual participants were
  recruited and actual scores recorded.
- No fabricated results, no simulated learners, no estimated outcomes.
- Limitations must be stated plainly in the case study.
- The hint ladder is an attempt-count policy, not a model of learner
  understanding.