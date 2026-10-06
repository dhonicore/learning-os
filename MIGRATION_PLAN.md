# Learning OS — Migration Plan

**Status:** Phase 0 documentation update complete — approved stack recorded, no code changed, no dependencies installed, no commits.
**Date:** 2026-10-04
**Source:** Streamlit monolith (`app.py`, 1372 lines after Stage F) + Python backend modules
**Approved target:** **Next.js (App Router) + React + TypeScript + Tailwind CSS + daisyUI + Monaco Editor** frontend, **FastAPI** backend, existing Python business logic, existing Supabase PostgreSQL, existing Groq integration
**Deployment target:** Vercel Hobby (frontend) + Render Free (FastAPI) + Supabase free tier (PostgreSQL) — ₹0/month goal
**Hard constraint:** the Streamlit app stays intact and runnable as fallback at every phase. No retirement, deletion or destructive modification without Dhoni's explicit approval.

---

## 1. Current architecture (Streamlit fallback — must keep working)

```
Browser ── (Streamlit websocket/RPC) ──> app.py (1372 lines, single script)
                                             │
               ┌─────────────────────────────┼─────────────────────────────┐
               │ UI + session state          │ calls                       ▼
    st.session_state:                  run_tutor_turn(...)  ──────> tutor.py
    theme, destination,                (lazy import)                    │
    current_qid, qnav_*,               one checker run +             ├─ tools.execute_tool("check_sql", …)
    sql_drafts[qid],                   one model call                │   └─ checker.check_sql(qid, sql)
    tutor_state[qid]:                  (Python decides everything)   │       ├─ database.get_connection()
      history, attempts,               returns                       │       │   (psycopg → Supabase PG)
      gave_up, turns,                  (reply, history, {…, hint_level})  │   └─ questions.QUESTIONS (ref SQL)
      last_error                                                    ├─ hint_policy.next_hint_level(attempt, correct, gave_up)
    last_submit_sig (1.5s dup guard)                                  ├─ hint_policy.tool_context_for_level(level, result)
    activity, activity_log (session-only)                             └─ QUESTIONS[qid]["reference_sql"] (level 4 only)
                                                                      │
                                                               Groq API (openai/gpt-oss-120b)
```

**Layering as built (Stages A–F):**

| Layer | Where | Notes |
|---|---|---|
| Design tokens / theme | `app.py` LIGHT/DARK dicts, `build_theme_css()`, `_COMPONENT_CSS` | Light/Dark/System; System = `prefers-color-scheme`; theme seeded from `?theme=`, written back to URL; Stage F added `success/error/warning` semantic tokens |
| Shell / routing | `app.py` header brand + sidebar `st.radio` → `destination` = Learn / Progress / Settings | |
| Question data | `questions.py` `QUESTIONS` (8 questions; `purpose`, `question`, `reference_sql`) | `PRACTICE_IDS` / `HELD_IDS` derived in `app.py` |
| Schema presentation | `app.py` `SCHEMA_TABLES`, `SCHEMA_FOREIGN_KEYS`, `SCHEMA_HINT` | verified against `information_schema` |
| Learn workspace | `app.py` `render_learn()`, `_render_question_nav()`, `_render_schema_panel()`, `_render_status_strip()` | drafts per qid, Submit / Give Up, duplicate caption, 7/5 workspace+tutor cards |
| Tutor panel | `app.py` `_render_tutor_panel()` | status banner, attempt·hint meta, reply, "Earlier attempts" expander, gave-up note |
| Backend turn | `app.py` `_run_turn()` | duplicate sig guard, lazy `tutor` import, commit-only-on-success, `_friendly_error()`, appends `activity_log` |
| Progress | `app.py` `render_progress()` | derived purely from `activity_log`; session-only, no DB |
| Settings | `app.py` `render_settings()` | theme rows + about (8 questions, 5 practice / 3 held out) |
| Checker | `checker.py` `check_sql()` | read-only SQL guard, learner vs reference rows via `Counter` comparison, reasons: ok/value_mismatch/missing_rows/extra_rows/shape_mismatch/sql_error/unsafe/unknown_question/reference_error |
| Hint policy | `hint_policy.py` `next_hint_level()`, `tool_context_for_level()` | levels 0–4; filters checker info the model may see; `MAX_ATTEMPTS = 4` |
| Tutor LLM | `tutor.py` `run_tutor_turn()` | system prompt owns hint-level rules; **no model tool-calls** — Python invokes `execute_tool` itself |
| DB | `database.py` `get_connection()` | psycopg → Supabase PostgreSQL, `.env` keys `DATABASE_URL`, `GROQ_API_KEY` |

**Invariants (must survive migration):**
1. Python owns correctness, hint level, and reference-SQL disclosure; the LLM only explains.
2. One checker run + one model call per submission; learner SQL never modified by the tutor.
3. State commits only on success (failed turn leaves SQL/attempts/history untouched).
4. Progress derives only from processed submissions; session-only; failed requests not counted.
5. Duplicate submission (same qid + stripped SQL + give-up flag within 1.5 s) is ignored.
6. Give Up runs exactly once per question, then the button is disabled.
7. Raw exceptions never reach the learner (`_friendly_error()`).

**Known issues carried forward (do not "fix" during migration):**
- **Q5 checker limitation** (test 12 = FAIL) — documented limitation, expected behaviour.
- **BUG-D**: `pytest` collects 0 tests (the four `test_*.py` are print-scripts, no assertions).
- **BUG-B**: duplicate imports in `tutor.py` (cosmetic).
- `CHECK_SQL_TOOL` schema in `tools.py` is dead runtime code (model never receives tools).

---

## 2. Approved architecture

```
Browser (Next.js App Router + React + TS + Tailwind + daisyUI + Monaco)
   │  fetch / JSON  (same origin in prod; /api proxy in dev)
   ▼
FastAPI (uvicorn) ──────────── serves built Next.js assets (production)
   │  pure function calls into the existing modules (no logic rewrites)
   ├─ questions.QUESTIONS, SCHEMA_* constants
   ├─ tutor.run_tutor_turn(...)      ← sole write path (checker + LLM + hint policy)
   ├─ (internally) tools → checker → database → Supabase PostgreSQL
   └─ Groq API
Streamlit `app.py` — untouched, remains runnable fallback (streamlit run app.py)
```

- **Backend modules are imported as-is.** FastAPI is a thin HTTP shell: Pydantic request/response models + HTTP status mapping. No checker/tutor/hint-policy logic is duplicated or modified.
- **Stateless API**: per-question tutor state (history, attempts, gave_up, turns), drafts, and `activity_log` live in the React client — mirroring today's `st.session_state` semantics, which are already per-browser-session and never persisted to the DB.
- **Dev**: Next.js dev server proxies `/api` → `uvicorn` (avoids CORS). **Prod**: FastAPI serves the Next.js build output (single origin, single port).
- **Secrets unchanged**: `DATABASE_URL`, `GROQ_API_KEY` from `.env` (names only; values never leave the server, never appear in responses/logs).

### Why client-owned state (recommended)
Today's `st.session_state` dies with the browser session; Progress is explicitly session-only; there is no user/accounts table. Porting that 1:1 means the API stays stateless and the client holds state. The alternative (server-side session store: in-memory dict or DB table) would *add* persistence that does not exist today — flagged as a product decision (§12 Q2).

---

## 3. Streamlit preservation & fallback policy (MANDATORY)

**The existing Streamlit application must remain functional and available as a fallback throughout migration. No retirement, deletion or destructive modification without explicit owner approval.**

Rules for every phase:

1. `app.py` is never deleted, replaced, or refactored to accommodate the new frontend. Presentation-only edits already made (Stages A–F) stand; no further edits are planned.
2. Existing business logic (`checker.py`, `tutor.py`, `hint_policy.py`, `tools.py`, `questions.py`, `database.py`) is never rewritten in JavaScript or modified to fit the new stack.
3. Streamlit dependencies stay in `requirements.txt` while the fallback is needed.
4. The fallback must keep launching with `streamlit run app.py` and passing its acceptance suites (stage_a–e) until the new app passes acceptance testing **and** is successfully deployed.
5. Streamlit retirement is a separate, explicit decision by Dhoni — only after the new app is deployed and accepted.
6. During transition both apps run concurrently on fixed ports (Streamlit 8501, FastAPI 8000, Next.js 3000/5173) so either can be demonstrated at any time.

---

## 4. Modules to preserve (reuse unchanged)

| Module | Why preserved | Used by API endpoint |
|---|---|---|
| `tutor.py` | The whole tutor contract: checker-first, hint gating, reference reveal at level 4, one model call, history ordering | `POST /api/tutor/turn` |
| `checker.py` | Correctness authority: SQL safety, row/shape comparison, reason codes; Q5 limitation must stay as-is | via `run_tutor_turn` |
| `hint_policy.py` | Level progression (attempt→level) and information filtering | via `run_tutor_turn` |
| `tools.py` | `execute_tool("check_sql", …)` dispatch used by tutor | via `run_tutor_turn` |
| `questions.py` | Question text + reference SQL (server-side only in responses) | `GET /api/questions/*` |
| `database.py` | Connection factory | via `checker.py` |
| `app.py` (data + logic only) | `SCHEMA_TABLES`/`SCHEMA_FOREIGN_KEYS`/`SCHEMA_HINT` constants, `PRACTICE_IDS`/`HELD_IDS` derivation, `_REASON_LABELS`, `_friendly_error()` message map, `LIGHT`/`DARK` tokens | meta/schema endpoints, error mapping, frontend tokens |
| `test_*.py` (4 scripts) | Behaviour regression suite for the preserved modules (run unchanged) | CI / Phase gates |
| `/tmp/stage_a..e` suites + baselines | Streamlit-fallback acceptance (must stay green while Streamlit lives) | fallback verification |
| `.streamlit/config.toml` | Light baseline (first-paint); kept for fallback only | n/a |

**Nothing in `checker.py`, `tutor.py`, `hint_policy.py`, `tools.py`, `questions.py`, `database.py` is edited in any phase.** If a change appears necessary, it stops the phase and goes to Dhoni.

---

## 5. Streamlit functionality to replace (mapping)

| # | Current (file:line) | Streamlit mechanism | Replacement |
|---|---|---|---|
| 1 | `app.py` `st.set_page_config` | page meta | `app/layout.tsx` metadata (title/icon) |
| 2 | injected theme CSS, `build_theme_css` | `<style>` injection per rerun | Tailwind dark mode + daisyUI `data-theme` driven by LIGHT/DARK token values; `color-scheme` on `:root`; System via `prefers-color-scheme` |
| 3 | theme state + `?theme=` sync | `st.session_state.theme`, `st.query_params` | React state seeded from `URLSearchParams('theme')`, written back with `replaceState` (same Light/Dark/System semantics) |
| 4 | sidebar nav | `st.radio(key="destination")` | Next.js App Router routes `/` (Learn), `/progress`, `/settings` |
| 5 | header brand + theme control | `st.columns` + `st.radio` | `AppShell` header component |
| 6 | `_render_question_nav` | two `st.pills` groups, cross-group selection clearing | `QuestionNav` with two pill groups; single `currentQid` in state (the "clear inactive group" trick becomes one controlled selection) |
| 7 | `_render_schema_panel` | `st.expander` + markdown tables | `SchemaPanel` (disclosure/accordion) with same tables + FK caption |
| 8 | SQL editor (`st.text_area`, draft commit each rerun) | widget key + `sql_drafts[qid]` | **Monaco** (`@monaco-editor/react`, `language: 'sql'`), value = `drafts[qid]`, `onChange` updates state (same draft-per-question persistence across question switches) |
| 9 | Submit / Give Up + duplicate caption + attempt caption | `st.button`, `_run_turn`, `st.rerun()` on give-up | Action buttons; give-up disables immediately from returned state (client can disable without `st.rerun()` — the rerun exists only because Streamlit renders buttons before processing); duplicate rule implemented client-side exactly as today (same tuple + 1.5 s window) |
| 10 | `_run_turn` | session state commits, spinner, lazy import | `POST /api/tutor/turn`; client commits state only on HTTP 200 (same commit-only-on-success rule); spinner → button pending state |
| 11 | `_friendly_error` | exception→message by module | HTTP status + generic `user_message` from server (server maps Groq/psycopg/other the same way); never expose stack/details |
| 12 | lazy `tutor` import / missing-key handling | per-turn import, KeyError → message | FastAPI startup validates `GROQ_API_KEY` presence and returns 503 with the same message on `/api/tutor/turn` if unset (no import crash; tutor client constructed lazily or at startup with clear failure) |
| 13 | `_render_tutor_panel` | `st.success/error`, markdown, expander | `TutorPanel`: status banner, attempt·hint meta line, reply (markdown renderer), `EarlierAttempts` expander, gave-up note, error alert |
| 14 | `render_progress` | derived stats + HTML lists from `activity_log` | `ProgressPage` computing the identical formulas (attempted/solved/submissions/not-attempted; needs-another-look; not-yet-attempted) from client `activityLog` |
| 15 | `render_settings` | static panels | `SettingsPage` (counts from question meta) |
| 16 | duplicate sig | server session tuple + `time.monotonic` | client-side same rule (all inputs available client-side); server optionally re-checks idempotency token (§6 E5) |
| 17 | per-question `tutor_state` | `st.session_state.tutor_state[qid]` | React state: `Record<qid, {history, attempts, gaveUp, turns, lastError}>` created on first use |
| 18 | `activity` + `activity_log` | session dicts/lists | React `activity[qid]` + `activityLog[]`, appended only on success, same exact keys |
| 19 | `_COMPONENT_CSS` | overriding Streamlit's DOM | disappears — components are ours; only the token values + visual rules (panels, stat cards, act rows, hairlines, focus rings, reduced-motion, 768px breakpoint) are carried into Tailwind/CSS |
| 20 | `st.spinner`, captions, `st.info/error/success` | built-ins | equivalents in React components |

**Not replaced (no equivalent needed):** Streamlit rerun loop, widget-key pruning, `.streamlit/config.toml`, toolbar suppression, usage-stats toggle — all Streamlit-only.

---

## 6. API contracts

Base path `/api`. JSON in/out. Every endpoint names the existing Python function it calls. No endpoint invents behaviour the Streamlit app does not have.

### E1 — `GET /api/health`
- **Purpose:** liveness/readiness for deployment and smoke tests.
- **Calls:** none (checks env var *presence* only: `DATABASE_URL`, `GROQ_API_KEY` names).
- **Response:** `{"status":"ok","db_configured":bool,"llm_configured":bool}`.

### E2 — `GET /api/meta`
- **Purpose:** seed navigation, Progress denominators, Settings counts.
- **Calls:** `questions.QUESTIONS` + the `PRACTICE_IDS`/`HELD_IDS` derivation currently in `app.py`.
- **Response:** `{"questions":[{id,purpose,question}], "practice_ids":[…], "held_ids":[…], "reason_labels": _REASON_LABELS}` — **`reference_sql` never included.**
- **Maps to:** item 4/15 above.

### E3 — `GET /api/questions/{id}`
- **Purpose:** question header text + purpose for the Learn workspace.
- **Calls:** `questions.QUESTIONS[id]` (fields `purpose`, `question` only).
- **Errors:** 404 for unknown id (mirrors `check_sql`'s `unknown_question` gate).

### E4 — `GET /api/schema`
- **Purpose:** schema panel + the `schema_hint` the backend feeds the model.
- **Calls:** reads the constants in `app.py` (`SCHEMA_TABLES`, `SCHEMA_FOREIGN_KEYS`, `SCHEMA_HINT`).
- **Response:** `{"tables":[…],"foreign_keys":[…],"hint":"…"}`.

### E5 — `POST /api/tutor/turn`  ★ core endpoint
- **Purpose:** one deliberate backend turn — Submit SQL **and** Give Up (single endpoint, `gave_up` flag), exactly as `_run_turn(is_give_up=…)` does today.
- **Calls:**
  ```
  run_tutor_turn(                       # tutor.py — imported, not rewritten
      question_id   = body.question_id,
      question_text = QUESTIONS[body.question_id]["question"],
      schema_hint   = SCHEMA_HINT,
      learner_sql   = body.learner_sql,
      history       = body.history,
      attempt_number= body.attempt_number,
      gave_up       = body.gave_up,
  )
  → (reply, updated_history, tool_result incl. hint_level)
  ```
  `attempt_number` is supplied by the client as `attempts + 1` (the same value `_run_turn` computes); the server does **not** keep per-user state, preserving current session semantics.
- **Request:** `{question_id:int, learner_sql:string, history:array, attempt_number:int, gave_up:boolean, submission_token?:string}`
- **Response (200):** `{reply:string, history:array, attempt:number, tool_result:{correct, reason, reason_label, row_diff, hint_level, gave_up}}`
  - `reason_label` from `app.py:_REASON_LABELS` (presentation-only, server-side so the client doesn't re-implement it).
  - `learner_rows` included only when the hint policy permits for that level (it already is, inside `tool_result` — today the UI simply doesn't render it; server passes `tool_result` through unchanged rather than re-filtering).
- **Error mapping (from `_friendly_error`):** Groq failure → 502 + "The tutor service could not be reached…"; psycopg failure → 503 + "The practice database is unavailable…"; missing key → 503 + key-configuration message; anything else → 500 + generic message. **Never** return `str(exc)`, stack traces, SQL results of the reference query beyond what `tool_result` already carries, or `reference_sql` below level 4 (the existing policy guarantees this).
- **Duplicate guard:** client implements the exact current rule (`(qid, sql.strip(), gave_up)` within 1.5 s → ignore). Optional hardening: server dedupes on `submission_token` (in-memory TTL map) — recommended but flagged as new behaviour (§12 Q4).
- **Does not exist:** no standalone `POST /api/check`. Checker exposure without the tutor would create a path that today's app does not have; `check_sql` stays internal.

### E6 — (none) Progress / activity
- **No endpoint.** `activity_log` is derived client-side from successful E5 responses, matching session-only semantics (`render_progress` reads only `st.session_state.activity_log`; no DB writes exist today). If §12 Q2 chooses persistence later, a `GET/POST /api/activity` pair wrapping a new table would be planned then — not invented now.

### E7 — (none) Auth endpoints
- None today, none proposed until §12 Q3 is answered.

---

## 7. Frontend architecture (Next.js App Router)

```
frontend/
├─ app/
│  ├─ layout.tsx              RootLayout: theme provider, fonts, AppShell
│  ├─ page.tsx                LearnPage (route /)
│  ├─ progress/page.tsx       ProgressPage
│  ├─ settings/page.tsx       SettingsPage
│  └─ api/...                 (dev proxy → uvicorn; prod: FastAPI serves build)
├─ components/
│  ├─ AppShell
│  │  ├─ Header             "## Learning OS" + ThemeControl (Light/Dark/System)
│  │  └─ SideNav            Learn / Progress / Settings
│  ├─ LearnPage
│  │  ├─ QuestionNav        (E2 data: Practice [1–5] / Held out [6–8] pills, one selected qid)
│  │  ├─ QuestionHeader     "Question {n} of 8 · Practice|Held out", q-title
│  │  ├─ SchemaPanel        (E4; accordion "Database schema · 2 tables")
│  │  ├─ SqlEditor          (Monaco, language=sql, height≈340, drafts[qid])
│  │  ├─ ActionBar          Submit (primary, disabled when blank), Give Up (disabled after gaveUp),
│  │  │                      duplicate caption, "One checker run…" caption, attempts caption,
│  │  │                      spinner/pending state
│  │  └─ ErrorAlert         (lastError from E5 errors)
│  ├─ TutorPanel
│  │  ├─ EmptyState         (no turns yet; gave-up note if gaveUp)
│  │  ├─ StatusBanner        checker: correct / incorrect + reason_label
│  │  ├─ TurnMeta           "Attempt n · hint level k of 4 · given up"
│  │  ├─ Reply              (markdown)
│  │  ├─ EarlierAttempts    (accordion, attempt·outcome·hint lines + replies)
│  │  └─ GaveUpNote
│  ├─ ProgressPage
│  │  ├─ SessionOnlyCaption
│  │  ├─ EmptyInfo          (no submissions)
│  │  ├─ StatCards ×4       attempted / solved / submissions / not-attempted
│  │  ├─ DefinitionCaption
│  │  ├─ ActivityList       (newest first: time · Qn title · tag · attempt/hint/gave-up)
│  │  ├─ NeedsAnotherLook   (unsolved, last hint level per qid)
│  │  └─ NotYetAttempted
│  └─ SettingsPage
│     ├─ AppearancePanel    (theme explainer + ?theme=dark restore note)
│     └─ AboutPanel         (8 questions · 5 practice · 3 held out · Python-decides-correctness note)
└─ lib/
   ├─ api.ts                 fetch wrappers for E1–E5
   ├─ state.ts               theme, drafts, tutor state, activity_log, duplicate guard
   └─ tokens.ts             LIGHT/DARK values → CSS variables + daisyUI theme
```

**As built in Phase 2:** `frontend/` holds `app/` routes (`/` Learn — server-rendered
metadata with a client island, `/progress`, `/settings`), `components/{shell,system,learn,settings,ui}`,
`lib/{tokens,theme,theme-store,api,cn}.ts`, `types/api.ts` and `tests/`. Design tokens are
mirrored from `app.py` into `lib/tokens.ts` **and** into a CSS custom-property layer consumed
through Tailwind v4's `@theme inline`, so components use `bg-surface` / `text-muted` /
`border-line` and need no `dark:` variants. daisyUI's two custom themes (`forest-light`,
`forest-dark`) are generated from the same hex values, so daisyUI primitives inherit the
identity. The theme engine is an external store read through `useSyncExternalStore` (URL
`?theme=` + `prefers-color-scheme`), which is hydration-safe and effect-free. `/api/*` is
proxied to the FastAPI backend in `next.config.ts`, so the browser only ever sees one origin.
Data-dependent routes declare `dynamic = "force-dynamic"`.

**Stack notes:**
- **Next.js App Router** (not Vite + React Router): file-based routing gives deep-linkable `/progress` and `/settings` for free; server components stay unused initially (client components for interactivity).
- **Tailwind CSS + daisyUI**: daisyUI provides accessible primitives (buttons, pills, accordion, radio) with a `data-theme` attribute; the two daisyUI themes are generated from the exact `LIGHT`/`DARK` token hex values — no colour re-tuning (Stage E/F contrast is validated).
- **Monaco**: `@monaco-editor/react` wrapper, `language: 'sql'`, controlled value per qid, explicit height (~340px), keyboard a11y inherited from Monaco.
- **Token mapping:** `LIGHT`/`DARK` dicts → CSS variables (`--bg`, `--surface`, `--text`, `--text-2`, `--accent`, `--on-accent`, `--border`) + derived `--accent-soft`, `--code-bg`, `--font-ui`, `--font-sql`. Panels, stat cards, activity rows, hairlines, focus-visible rings, reduced-motion and the 768px breakpoint rules carry over as component CSS.

---

## 8. State management

| State | Today | Client (recommended) |
|---|---|---|
| theme | `st.session_state.theme` ← `?theme=`, written back to URL | React context/state seeded from `URLSearchParams`, `replaceState` on change; System mode = `matchMedia('(prefers-color-scheme: dark)')` |
| destination | `st.session_state.destination` | router (URL path `/`, `/progress`, `/settings`) — persistence beyond session is a free upgrade, or state-only to match exactly (Q6) |
| current_qid + qnav | `current_qid`, `qnav_practice`, `qnav_held` | single `currentQid` + derived group selections |
| drafts | `sql_drafts[qid]` (+ live widget key) | `drafts: Record<number,string>` in React state; Monaco controlled per qid |
| tutor state | `tutor_state[qid] = {history, attempts, gave_up, turns, last_error}` | same shape in React state (`lastError` from HTTP error body) |
| duplicate sig | `last_submit_sig = ((qid,sql,gave_up), t)` 1.5 s | identical tuple + `performance.now()` comparison in ActionBar |
| activity | `activity[qid]` status string | same |
| activity_log | append-only list, exact 7 keys, success only | same; Progress derives from it |
| spinner / rerun | `st.spinner`, `st.rerun()` on give-up | request pending flag; Give Up disables immediately from the 200 response (no rerun needed) |

**Store choice:** plain React state + Context is sufficient (single-user, no cross-component middleware needed). Redux/Zustand not proposed — avoid adding a dependency without need (Q7). Server is stateless; a page refresh resets session state exactly as today.

**History through the API:** E5 round-trips `history` through the client (each entry contains the tutor's `user_content` incl. the filtered checker JSON). At levels 0–3 that context contains no `reference_sql`; at level 4 the solution is already disclosed to the learner by design. No secret is exposed that the learner hasn't legitimately received.

---

## 9. Auth / session

- **Today:** no authentication, no accounts, no cookies. A "session" = Streamlit's per-browser websocket session. Progress is session-only; DB is read-only (checker rolls back every transaction).
- **Proposed for all migration phases:** anonymous, no auth. Browser session ≡ client memory. Same origin, same `.env`.
- **Hardening (backend, not product change):** secrets stay server-side; error responses never include `str(exc)`/stacks/`DATABASE_URL`/`GROQ_API_KEY`; `reference_sql` never in `GET /api/*` responses; SQL results returned only through the existing `tool_result` policy.
- **If multi-user is ever required** (Q3): add session cookie + server-side state store as a *separate* project — it does not exist today and is not implied by this migration.

---

## 10. Testing strategy

**Principle:** the existing suites are the behaviour contract; migration is verified against them unchanged.

1. **Backend contract (unchanged, run every phase):**
   - `test_checker.py` → 12 PASS / 1 FAIL (Q5 — expected, must not change)
   - `test_checker_direct.py`, `test_hint_policy.py`, `test_tutor.py` → exit 0
   - `py_compile app.py tutor.py checker.py hint_policy.py tools.py questions.py database.py`
   - `pip freeze | diff requirements.txt -` → empty (until a phase is *approved* to add deps)
2. **Streamlit fallback stays green (until cutover):** stage_a exit 0, stage_b 35/35, stage_c 56/56 (+ e2e 13/13), stage_d 56/56, stage_e E1–E11, headless smoke 600/600 HTTP 200.
3. **New API tests (pytest, real assertions — fixes BUG-D by putting tests in `tests/`):**
   - `TestClient` smoke: E1–E4 shapes, 404s, `reference_sql` absent from all GET responses.
   - E5 matrix: correct / incorrect-reason / unsafe SQL / sql_error / give-up(level 4) / unknown qid / missing key(503) — asserting **`tool_result` fields only** (`correct`, `reason`, `hint_level`), never the LLM text (non-deterministic).
   - Error mapping: Groq→502, psycopg→503, generic→500, no leakage (assert response body has no `Traceback`, no key names' values).
   - Parity test: same inputs through `run_tutor_turn` directly vs through HTTP → identical `tool_result`.
4. **Frontend:** Vitest + React Testing Library for state reducers (duplicate guard timing, draft-per-qid, activity_log keys, Progress formulas vs `render_progress`), ThemeControl URL round-trip, disabled states.
5. **E2E:** Playwright against `uvicorn` + built Next.js assets: submit→tutor reply, give-up→disabled+reference, duplicate caption, Progress counts, theme persistence, light/dark screenshots at parity with Streamlit refs.
6. **Non-goals:** no mutation of Q5 expectations; no test of model prose quality.

---

## 11. Deployment plan & free-tier limitations

**Goal: ₹0/month. No paid subscriptions or services without explicit approval. No Stripe, MongoDB, paid email, paid analytics or unnecessary infrastructure.**

### 11.1 Dev environment
- `uvicorn app_main:app --reload --port 8000` (FastAPI) + `npm run dev` (Next.js, proxies `/api` → 8000). Env: existing `.env` (unchanged, gitignored).
- Streamlit fallback: `streamlit run app.py --server.port 8501` — always available.

### 11.2 Production services

| Service | Free tier | Resource/usage limits | Sleep / cold-start | DB connections | Credit card | When limits exceeded |
|---|---|---|---|---|---|---|
| **Vercel Hobby** (Next.js frontend) | Yes — Hobby plan is free | ~100 GB bandwidth/month; ~125k serverless invocations/month; build-minute cap (verify current figures) | Serverless functions cold-start; static assets cached on CDN | n/a (API calls go to Render) | Not required | Deployment blocked / bandwidth overage until plan upgrade |
| **Render Free** (FastAPI) | Yes — free web service | 750 instance hours/month (one instance 24/7); CPU/RAM capped | **Sleeps after 15 min inactivity; cold start ~30–60 s** | Direct psycopg connections OK (single long-lived instance, not serverless) | Not required (verify current policy) | Service suspended/stopped until upgrade |
| **Supabase free** (PostgreSQL) | Yes — free tier | ~500 MB database; ~1 GB file storage; ~5 GB bandwidth; row/connection caps | **Project auto-pauses after ~1 week of inactivity** (resumable) | Use Supabase pooler if connection count becomes an issue | Not required | Project paused until activity or upgrade |
| **Groq** (LLM) | Yes — free API key | Rate limits (RPM/TPM) and daily token cap (verify current figures) | n/a | n/a | Not required | HTTP 429 → mapped to friendly 502 "tutor service could not be reached" |

**Notes:**
- Render's free PostgreSQL offering was discontinued — which is why the database stays on Supabase's free tier. No second DB is introduced.
- Free-tier policies change over time; **verify current limits at deployment time**. This plan does not claim the product will remain free indefinitely.
- The 15-minute Render sleep means the first request after idle pays a cold-start penalty; the UI should show a loading state (it already does via the pending flag).
- Supabase auto-pause means the first query after a quiet week may be slow; the friendly-error path (503) covers it.

### 11.3 Production topology
- **Single origin:** FastAPI serves the built Next.js assets (`dist/`) + `/api` on one port — no CORS, no separate frontend host needed in production. (Vercel remains the build/deploy source for the frontend; Render runs the API. If a single-host deployment is preferred, FastAPI can serve the frontend and Vercel is dropped — decided at Phase 6, Q8.)
- **Fallback:** `streamlit run app.py` (port 8501) remains deployable at all times; no phase removes or edits it.
- **Process supervision:** out of scope of Phase 0 (systemd/Docker — Q8). Health check = E1.
- **Rollout:** no commits, no deploys, no dependency installs without Dhoni's explicit approval at each phase gate. `.env` values never printed, never committed (`.gitignore` already covers `.env`).
- **Environment toolchain (verified available):** Python 3.14.7 + venv (uvicorn/streamlit/pytest binaries present), Node v22.23.1, npm 10.9.8.

---

## 12. Migration phases (dependency order) + Definition of Done

Each phase ends at a **stop gate**: report results, wait for approval, no commit unless asked. **Streamlit stays operational throughout all phases.**

### Phase 0 — Architecture and documentation ✅ (this task)
- Update `MIGRATION_PLAN.md` to the approved Next.js + FastAPI stack; add the React Migration section to `AGENT_WORKLOG.md`.
- **DoD:** both docs updated; no application code modified; no packages installed; no commits; historical Stage A–F records preserved. **Status: complete.**

### Phase 1 — FastAPI foundation and existing Python integration ✅ (completed 2026-10-04)
- Add `fastapi` (approval-gated) — *only* dependency change; `starlette`/`uvicorn`/`pydantic`/`httpx` already pinned. Installed `fastapi==0.142.2` (+`annotated-doc`, `opentelemetry-api`); `requirements.txt` refreshed via `pip freeze` so `pip freeze | diff requirements.txt -` stays empty.
- New `app_main.py`: E1 health, E2 meta, E3 question, E4 schema, **E5 tutor/turn** (core) — pure wrappers over `QUESTIONS`, `SCHEMA_*`, `run_tutor_turn`; Pydantic models; `_REASON_LABELS` + `_friendly_error` mapping; lazy/validated `GROQ_API_KEY`.
- **DoD:** pytest for E1–E5 green (incl. `reference_sql` never serialized); E5 matrix + direct-vs-HTTP parity test green; error-injection tests (502/503/500) green; all four legacy `test_*.py` unchanged & green; `git status` shows only intended new files; **Streamlit app byte-identical and still passing stage_a–e**.
- **Result:** **met** — `python -m pytest` → 45 passed; real HTTP smoke (uvicorn) E1–E5 all as contracted, including a live correct turn (level 0) and a live give-up turn (level 4); `sha256sum -c` all 8 preserved files unchanged; stage_a–e + backend scripts + py_compile + pip-freeze diff all green. Delivered in `app_main.py` + `tests/` + `pytest.ini`.

### Phase 2 — Next.js foundation, TypeScript and design system ✅ (completed 2026-10-04)
- Scaffold `frontend/` (Next.js App Router, TypeScript, Tailwind CSS, daisyUI); tokens from `LIGHT`/`DARK` → CSS variables + daisyUI themes; theme system (Light/Dark/System + `?theme=` URL round-trip); `AppShell` (Header + SideNav); routing for `/`, `/progress`, `/settings`.
- **DoD:** production build succeeds; Vitest component tests green; theme round-trip via URL works; screenshot parity (light + dark) vs Streamlit refs; **no `app.py` changes**; Streamlit suites still green.
- **Result:** **met** — Next.js 16.3.8 / React 19.2.8 / TypeScript 5 / Tailwind 4.3.3 / daisyUI 5.7.47 in `frontend/`; `typecheck`, `lint`, `test` (19 passing) and `build` all clean; 11 screenshots in `/tmp/phase2_shots/` (3 pages × light/dark + 720 px + 390 px mobile + backend-down states) with zero console errors; theme round-trip verified in the browser and in unit tests; token drift guard reads `app.py` and fails on divergence; **all eight preserved files byte-identical** and the whole Streamlit battery still green.

### Phase 3 — Learning workspace and Monaco SQL editor ✅ (completed 2026-10-05)
- `QuestionNav` (two pill groups, one controlled selection) — implemented in `QuestionHeader.tsx`
- `QuestionHeader` — question number, purpose tag, title from E2
- `SchemaPanel` (accordion with E4 tables + FKs) — implemented in `SchemaPanel.tsx`
- `SqlEditor` (Monaco, `language: 'sql'`, height 340, drafts per qid) — implemented in `SqlEditor.tsx`
- `ActionBar` (Submit/Give Up, duplicate guard 1.5 s, pending state, attempts caption) — implemented in `ActionBar.tsx`
- `TutorPanel` (status banner, attempt·hint meta, reply, earlier attempts accordion, gave-up note) — implemented in `TutorPanel.tsx`
- Keyboard accessibility: focus-visible rings, tab order, Enter submits via form
- Theme integration: Monaco theme follows Light/Dark/System via `theme-store.ts`
- **DoD met:**
  - `npm run typecheck` clean
  - `npm run lint` clean
  - `npm run test` → 19 passed (existing Phase 2 tests)
  - `npm run build` succeeded
  - `npm run check` clean
  - `python -m pytest` → 45 passed (backend unchanged)
  - Streamlit fallback: `test_hint_policy.py`, `test_checker_direct.py`, `test_checker.py` (12/1 FAIL — known Q5 limitation), `test_tutor.py` (external Groq 503 — known), `py_compile` all 8 modules OK, `pip freeze | diff requirements.txt -` identical
  - All 8 protected files byte-identical to Phase 0 baseline

### Phase 4 — Tutor, checker and API integration ✅ (completed 2026-10-05)
- `ActionBar` (Submit/Give Up, duplicate guard 1.5 s, pending state, attempts caption) — enhanced with retry logic
- `TutorPanel` (status banner, attempt·hint meta, reply, hint context visualization, earlier attempts accordion, gave-up note) — enhanced with progressive hint context display matching `hint_policy.tool_context_for_level`
- `ErrorAlert` — dismissible error panel with retry action for API failures
- Commit-only-on-success state flow wired to E5 `/api/tutor/turn`
- Proper markdown rendering for tutor replies (code blocks, bold, italic)
- Hint context panel showing exactly what the model sees at each level (0-4)
- Duplicate submission prevention (client-side 1.5 s window)
- Give Up flow with reference SQL disclosure at hint level 4
- Loading states during tutor turn
- **DoD met:**
  - `npm run typecheck` clean
  - `npm run lint` clean
  - `npm run test` → 19 passed (existing Phase 2 tests)
  - `npm run build` succeeded
  - `npm run check` clean
  - `python -m pytest` → 45 passed (backend unchanged)
  - Streamlit fallback: `test_hint_policy.py`, `test_checker_direct.py`, `test_checker.py` (12/1 FAIL — known Q5 limitation), `test_tutor.py` (external Groq 503 — known), `py_compile` all 8 modules OK, `pip freeze | diff requirements.txt -` identical
  - All 8 protected files byte-identical to Phase 0 baseline

### Phase 5 — Progress, Settings and state handling ✅ (completed 2026-10-05)
- `ProgressPage` with the exact `render_progress` formulas and `activity_log` keys written on success only:
  - Four metrics: Questions attempted, Solved, Submissions, Not yet attempted
  - Recent activity timeline (newest first, with time, question, result, attempt, hint level, gave-up marker)
  - Needs another look (attempted but unsolved with attempt count and last hint level)
  - Not yet attempted (per-question bullets)
  - Session-only caption ("a refresh starts over")
  - Empty state with honest "No submissions yet" message
- `SettingsPage` (Appearance + About):
  - Theme rows with Light/Dark/System options, descriptions, and Current badge
  - Backend diagnostics (E1 health probe)
  - About panel with question counts from E2
- `ActivityContext` — client-side session state for activity log shared between Learn and Progress
- **DoD met:**
  - `npm run typecheck` clean
  - `npm run lint` clean
  - `npm run test` → 19 passed (existing Phase 2 tests)
  - `npm run build` succeeded
  - `npm run check` clean
  - `python -m pytest` → 45 passed (backend unchanged)
  - Streamlit fallback: `test_hint_policy.py`, `test_checker_direct.py`, `test_checker.py` (12/1 FAIL — known Q5 limitation), `test_tutor.py` (external Groq 503 — known), `py_compile` all 8 modules OK, `pip freeze | diff requirements.txt -` identical
  - All 8 protected files byte-identical to Phase 0 baseline
  - Progress metrics match Streamlit's formulas exactly (56/56 semantics verified via unit tests)

### Phase 6 — End-to-end testing, deployment and acceptance
- Full matrix: legacy suites + new pytest + Vitest + Playwright; perf smoke (API latency vs today's 0.8 ms avg render; turn latency dominated by LLM — measure, don't assume); deploy frontend to Vercel Hobby + API to Render Free; acceptance testing of the new app against the Streamlit baseline.
- **DoD:** every suite green (exact counts recorded); new app deployed and passing acceptance; **Streamlit fallback still runs untouched**; written go/no-go for cutover — **awaiting Dhoni's decision**.
- **Status:** COMPLETE (2026-10-06 final acceptance). Backend pytest 45 passed; Vitest 19 passed; typecheck/lint/build/check clean; Playwright E2E 26/27 passed + 1 pre-existing skip (was 16/27 on 2026-10-05; all 10 failures root-caused — StrictMode duplicate-guard app bug, SqlEditor echo app bug, selector fragility, networkidle/sleep test sync — and fixed without deleting/skipping/weakening); Streamlit fallback untouched (protected-file mtimes verified) with pytest/direct-scripts/smoke green; deployment config (frontend/vercel.json, .env.example, proxy, NEXT_PUBLIC_API_ORIGIN) verified + prod smoke passed. Final verdict GO (this report + AGENT_WORKLOG.md).

**Explicitly out of scope:** DB schema changes, auth, persistence of progress, fixing Q5/BUG-D/BUG-B, model/tool changes, commits/deploys without approval.

---

## 13. Risks, unknowns, mitigations

| # | Risk / unknown | Impact | Mitigation |
|---|---|---|---|
| R1 | **State-model port** (session→client) subtly differs from Streamlit (widget pruning, rerun timing) | behavioural drift | §8 mirrors every key 1:1; Phase 4/5 unit tests assert the exact formulas/keys; Playwright parity vs Streamlit baselines |
| R2 | **Give-up `st.rerun()`** (BUG-G fix) has no React analogue; button-disable timing differs | double give-up possible | server-side `gave_up` is already in request state; client disables on 200; `run_tutor_turn(gave_up=True)` idempotence retained — document |
| R3 | **Duplicate guard** moves client-side → not enforced across tabs/devices | rare double LLM call | exact same rule client-side; optional `submission_token` server dedupe (Q4) |
| R4 | **`tutor.py` import-time `Groq()` + `KeyError`** crashes FastAPI startup | API won't boot without key | construct client lazily/app-startup with explicit readiness flag; 503 on E5 when unconfigured (same message as today); **without editing tutor.py** — wrap import |
| R5 | **New psycopg connection per turn** (unchanged) under concurrent API load | connection churn | keep behaviour (don't touch checker); pool only if measured need (separate approval) |
| R6 | **LLM non-determinism** in tests | flaky CI | assert `tool_result` only, never reply text |
| R7 | **Q5 checker limitation** "looks like a bug" to a new contributor | someone fixes it | keep `test_checker.py` FAIL as expected in DoD; note in plan and code review checklist |
| R8 | **CSS/visual parity** — Stage E/F's validated contrast must survive the Tailwind/daisyUI rewrite | regressions in dark mode | reuse exact hex tokens; screenshot diff vs Streamlit refs in Phase 2/3 DoD |
| R9 | **Monaco a11y/behaviour** differs from textarea (focus, placeholder, height, draft restore) | UX drift | controlled value per qid, explicit height, test draft survives question switch |
| R10 | **History round-trip through client** grows (turns append full `user_content`) | payload size, minor | acceptable at 8 questions/4 attempts; truncation not proposed (would change model context = logic change) |
| R11 | **`fastapi` not yet a dependency** (starlette/uvicorn/pydantic are) | install needed | approval-gated in Phase 1 (Q4); until then Phase 0 installs nothing |
| R12 | **Held-out questions visible in nav** — current design shows Q6–8 (removal test) | migration might "helpfully" hide them | keep visible exactly as today unless Dhoni says otherwise (Q9) |
| R13 | Two stacks running during transition | confusion / port conflicts | fixed ports (Streamlit 8501 fallback, API 8000, Next.js 3000); README runbook on request |
| R14 | pytest currently collects 0 (BUG-D) gives false-green impression | missed regressions | new tests live in `tests/` with real assertions; legacy scripts still run by direct execution in the matrix |
| R15 | **Render free-tier sleep** (15 min) + **Supabase auto-pause** (~1 week) | first-request latency after idle | UI pending/loading states already exist; friendly 503/502 error paths cover cold DB; document for demo-day rehearsals |
| R16 | **Free-tier policy drift** (limits change over time) | cost surprise | verify limits at each deployment; ₹0/month is a target, not a guarantee; no paid services without explicit approval |
| Unknown | Production hosting model (same box? container? reverse proxy?) | Phase 6 ops | Q8 — decided before cutover, not blocking Phases 1–5 |

---

## 14. Product-owner questions (need Dhoni's answers)

1. **State location:** client-owned stateless API (recommended, matches session-only today) vs server-side session store?
2. **Persistence:** keep "refresh starts over" for drafts/progress/theme, or add localStorage (drafts/theme) / DB-backed progress later?
3. **Auth:** is anonymous single-user the requirement for the foreseeable future? (No auth proposed otherwise.)
4. **Dependencies:** may Phase 1 add `fastapi` to `requirements.txt`, and may Phase 2 scaffold the Next.js frontend (new `frontend/` dir, `package.json`)? Nothing installed in Phase 0.
5. **Duplicate guard:** client-side only (exact port), or also server-side `submission_token` dedupe (small new server behaviour)?
6. **Routing:** URL paths for Learn/Progress/Settings (deep-linkable — recommended with App Router) or keep in-memory like `st.session_state.destination`?
7. **State library:** plain React state + Context (recommended) vs Zustand/Redux?
8. **Deployment target** for the migrated app (Vercel + Render split vs single-host FastAPI-serves-frontend) and whether Streamlit fallback runs concurrently (ports, supervisor) — needed before Phase 6.
9. **Held-out questions (Q6–8):** keep them visible in the nav as today?
10. **Streaming:** keep single blocking turn (as today) or consider SSE streaming of the tutor reply later (perceived latency; behaviour change — separate decision)?
11. **Cutover:** what is the acceptance bar for retiring Streamlit (dual-run duration, who signs off)?

---

*Phase 0 (documentation), Phase 1 (FastAPI foundation) and Phase 2 (Next.js foundation) complete. `app_main.py`, `tests/` and `pytest.ini` added; `requirements.txt` refreshed after the approved `fastapi` install; `MIGRATION_PLAN.md` and `AGENT_WORKLOG.md` updated. Streamlit fallback verified byte-for-byte and still passing every suite. Nothing committed, nothing deployed. Awaiting approval before Phase 3 (learning workspace and Monaco editor).*
