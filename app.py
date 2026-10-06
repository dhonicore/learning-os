"""Learning OS — Streamlit application.

Stage A: design tokens, theme system (Light / Dark / System) and the
application shell (header, navigation, destination routing).

Stage B: the Learning workspace — grouped question navigation, question
header, shared database schema panel, per-question SQL draft editor.

Stage C: tutor integration — Submit SQL and Give Up call the existing
Python-first run_tutor_turn() backend (one checker run + one model call
per submission). Hint levels, correctness and reference disclosure come
only from the backend; the UI never re-implements the hint policy and
never executes SQL itself.

Stage D: Progress — session-level learning progress built only from
successfully processed submissions (checker-confirmed correctness), with
a chronological activity log. Session-only: no database calls, no
cross-session persistence.
"""

from datetime import datetime
import html
import time
import traceback

import streamlit as st

from questions import QUESTIONS

# ------------------------------------------------------------------
# Question groups and shared schema (verified against
# information_schema on 2026-10-04; all 8 questions use these tables)
# ------------------------------------------------------------------

PRACTICE_IDS = [qid for qid, q in QUESTIONS.items() if q["purpose"] == "practice"]
HELD_IDS = [qid for qid, q in QUESTIONS.items() if q["purpose"] == "held_out"]

SCHEMA_TABLES = (
    ("customers", (("id", "integer"), ("name", "text"), ("city", "text"))),
    (
        "orders",
        (
            ("id", "integer"),
            ("customer_id", "integer"),
            ("order_date", "date"),
            ("amount", "integer"),
        ),
    ),
)

SCHEMA_FOREIGN_KEYS = (("orders.customer_id", "customers.id"),)

# Schema hint passed to the tutor backend (same format the backend
# tests use). Verified against information_schema (see build_log.md).
SCHEMA_HINT = (
    "customers(id int, name text, city text); "
    "orders(id int, customer_id int, order_date date, amount int)"
)

# Presentation-only labels for checker reasons (display, not logic).
_REASON_LABELS = {
    "ok": "the result matches the expected answer",
    "value_mismatch": "your output differs from the expected result",
    "missing_rows": "expected rows are missing from your output",
    "extra_rows": "your output contains extra rows",
    "shape_mismatch": "your columns do not match the expected shape",
    "sql_error": "the query could not run",
    "unsafe": "only read-only SELECT queries are allowed",
    "unknown_question": "unknown question",
    "reference_error": "the reference query failed",
}

# ------------------------------------------------------------------
# Design tokens
# ------------------------------------------------------------------

LIGHT = {
    "bg": "#F4F3EE",
    "surface": "#FFFFFF",
    "text": "#202722",
    "text-2": "#657067",
    "accent": "#285D3D",
    "on-accent": "#FFFFFF",
    "border": "#E5E6DF",
    "success": "#1B6E40",
    "error": "#A93226",
    "warning": "#7A5B12",
}

DARK = {
    "bg": "#191E1B",
    "surface": "#242B26",
    "text": "#F0F1EA",
    "text-2": "#A8B2A9",
    "accent": "#9CC5A4",
    "on-accent": "#191E1B",
    "border": "#3C453E",
    "success": "#8CC7A2",
    "error": "#E8A199",
    "warning": "#D9BC76",
}

THEMES = ("Light", "Dark", "System")

_EXTRA_TOKENS = """
  --accent-soft: color-mix(in srgb, var(--accent) 10%, var(--surface));
  --code-bg: color-mix(in srgb, var(--text) 5%, var(--surface));
  --surface-2: color-mix(in srgb, var(--text) 3%, var(--surface));
  --success-soft: color-mix(in srgb, var(--success) 9%, var(--surface));
  --error-soft: color-mix(in srgb, var(--error) 9%, var(--surface));
  --warning-soft: color-mix(in srgb, var(--warning) 12%, var(--surface));
  --line: color-mix(in srgb, var(--text) 14%, transparent);
  --radius-card: 12px;
  --radius-ctl: 8px;
  --font-ui: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  --font-sql: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
    "Liberation Mono", monospace;
"""

_COMPONENT_CSS = """
/* ---- App frame -------------------------------------------------- */
html, body {
  background: var(--bg);
  color: var(--text);
}
[data-testid="stAppViewContainer"],
[data-testid="stMain"],
.main {
  background: var(--bg);
  color: var(--text);
}
[data-testid="stAppViewContainer"] { font-family: var(--font-ui); }
[data-testid="stHeader"] { display: none; }
[data-testid="stToolbar"] { background: transparent; }
[data-testid="stDecoration"] { display: none; }
[data-testid="stMainBlockContainer"] {
  max-width: 1280px;
  padding: 1.35rem 2.25rem 3.5rem;
}

/* ---- Sidebar ---------------------------------------------------- */
[data-testid="stSidebar"] {
  background: var(--surface);
  border-right: 1px solid var(--border);
}
[data-testid="stSidebarContent"] { padding-top: 1.4rem; }
[data-testid="stSidebar"] [data-testid="stWidgetLabel"] {
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-2);
}

/* ---- Typography ------------------------------------------------- */
[data-testid="stMarkdownContainer"] h1 {
  font-size: 1.45rem; font-weight: 600; letter-spacing: -0.01em;
  margin-bottom: 0.4rem;
}
[data-testid="stMarkdownContainer"] h2 {
  font-size: 1.18rem; font-weight: 600; letter-spacing: -0.01em;
}
[data-testid="stMarkdownContainer"] h3 {
  font-size: 1.0rem; font-weight: 600;
}
[data-testid="stMarkdownContainer"] p,
[data-testid="stMarkdownContainer"] li { line-height: 1.6; }
[data-testid="stCaptionContainer"] { color: var(--text-2); font-size: 0.84rem; }
[data-testid="stWidgetLabel"] { color: var(--text); }
[data-testid="stMarkdownContainer"] a {
  color: var(--accent); text-decoration: none;
}
[data-testid="stMarkdownContainer"] a:hover { text-decoration: underline; }
[data-testid="stMarkdownContainer"] table {
  border-collapse: collapse; width: 100%; font-size: 0.92rem;
}
[data-testid="stMarkdownContainer"] th,
[data-testid="stMarkdownContainer"] td {
  border-bottom: 1px solid var(--border);
  padding: 0.55rem 0.7rem; text-align: left; vertical-align: top;
}
[data-testid="stMarkdownContainer"] th {
  color: var(--text-2); font-weight: 500; font-size: 0.78rem;
  text-transform: uppercase; letter-spacing: 0.05em;
}

/* ---- Brand, page titles, eyebrows ------------------------------- */
.brand {
  display: flex; align-items: baseline; gap: 0.8rem;
  padding-top: 0.15rem;
}
.brand-name {
  font-size: 1.22rem; font-weight: 650; letter-spacing: -0.015em;
  color: var(--text);
}
.brand-sub {
  font-size: 0.7rem; font-weight: 600; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--text-2);
}
.page-title {
  font-size: 1.35rem; font-weight: 650; letter-spacing: -0.015em;
  color: var(--text); margin: 0.15rem 0 0.3rem;
}
.nav-eyebrow, .q-eyebrow {
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
  color: var(--text-2);
}
/* Question meta line stays uppercase; nav group labels stay in natural
   case because the browser acceptance suite reads them via innerText
   (which reflects text-transform). */
.q-eyebrow { text-transform: uppercase; margin-bottom: 0.55rem; }
.nav-eyebrow { margin-bottom: 0.5rem; }

/* ---- Radio pills (theme control + sidebar navigation) ----------- */
[data-testid="stRadio"] div[role="radiogroup"] {
  display: flex; gap: 0.4rem; width: 100%;
}
[data-testid="stSidebar"] [data-testid="stRadio"] div[role="radiogroup"] {
  flex-direction: column; gap: 0.3rem;
}
[data-testid="stMain"] [data-testid="stRadio"] div[role="radiogroup"] {
  flex-direction: row; justify-content: flex-end;
}
/* Exclude the widget label itself: Streamlit hides collapsed labels with
   display:none, which this pill styling would otherwise override. */
[data-testid="stRadio"] label:not([data-testid="stWidgetLabel"]) {
  display: flex; align-items: center; gap: 0.45rem;
  padding: 0.42rem 0.8rem; border-radius: var(--radius-ctl);
  border: 1px solid transparent; color: var(--text-2);
  font-size: 0.9rem; font-weight: 500; cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
[data-testid="stSidebar"] [data-testid="stRadio"] label { width: 100%; }
[data-testid="stRadio"] label:not([data-testid="stWidgetLabel"]):hover {
  background: var(--accent-soft); color: var(--text);
}
[data-testid="stRadio"] label:has(input:checked) {
  background: var(--accent-soft); border-color: var(--border);
  color: var(--accent); font-weight: 600;
}
[data-testid="stSidebar"] [data-testid="stRadio"] label:has(input:checked) {
  box-shadow: inset 3px 0 0 var(--accent);
}
[data-testid="stRadio"] label:has(input:focus-visible) {
  outline: 2px solid var(--accent); outline-offset: 1px;
  background: var(--accent-soft);
}
[data-testid="stRadio"] label:has(input:focus-visible:not(:checked)) {
  color: var(--text);
}
/* Children carry baked light-theme colors; follow the label's token color. */
[data-testid="stRadio"] label * { color: inherit; }
/* Radio circles: token-driven rings instead of Streamlit's baked light colors. */
[data-testid="stRadioOption"]:not([data-selected="true"]) > div > div > div:first-child {
  background: transparent;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--text-2) 60%, transparent);
}
[data-testid="stRadioOption"]:not([data-selected="true"]) > div > div > div:first-child > div {
  background: transparent;
}
[data-testid="stRadioOption"][data-selected="true"] > div > div > div:first-child {
  background: var(--accent); box-shadow: none;
}
[data-testid="stRadioOption"][data-selected="true"] > div > div > div:first-child > div {
  background: var(--on-accent);
}

/* ---- Buttons ---------------------------------------------------- */
[data-testid="stMain"] [data-testid^="stBaseButton"],
[data-testid="stSidebar"] [data-testid^="stBaseButton"] {
  border-radius: var(--radius-ctl); border: 1px solid var(--border);
  background: var(--surface); color: var(--text);
  font-weight: 500; font-size: 0.9rem; font-family: inherit;
  transition: background-color 0.12s ease, border-color 0.12s ease,
              color 0.12s ease;
}
[data-testid="stMain"] [data-testid^="stBaseButton"]:hover,
[data-testid="stSidebar"] [data-testid^="stBaseButton"]:hover {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}
[data-testid="stMain"] [data-testid^="stBaseButton-primary"] {
  background: var(--accent); border-color: var(--accent);
  color: var(--on-accent); font-weight: 600;
}
[data-testid="stMain"] [data-testid^="stBaseButton-primary"]:hover {
  background: color-mix(in srgb, var(--accent) 86%, var(--text));
  border-color: color-mix(in srgb, var(--accent) 86%, var(--text));
  color: var(--on-accent);
}
/* Give Up (secondary): quiet ghost at rest, soft error cue on hover. */
[data-testid="stMain"] [data-testid^="stBaseButton-secondary"] {
  background: transparent; border-color: transparent; color: var(--text-2);
}
[data-testid="stMain"] [data-testid^="stBaseButton-secondary"]:hover {
  background: var(--error-soft);
  border-color: color-mix(in srgb, var(--error) 30%, transparent);
  color: var(--error);
}
[data-testid="stMain"] [data-testid^="stBaseButton-tertiary"] {
  background: transparent; border-color: transparent; color: var(--text-2);
}
[data-testid="stMain"] [data-testid^="stBaseButton-tertiary"]:hover {
  background: var(--accent-soft); color: var(--text);
}
[data-testid="stMain"] [data-testid^="stBaseButton"]:disabled {
  opacity: 0.5; cursor: not-allowed;
}
[data-testid="stMain"] [data-testid^="stBaseButton"]:disabled:hover {
  background: var(--surface); border-color: var(--border); color: var(--text);
}
[data-testid="stMain"] [data-testid^="stBaseButton-primary"]:disabled:hover {
  background: var(--accent); border-color: var(--accent);
  color: var(--on-accent);
}
[data-testid="stMain"] [data-testid^="stBaseButton-secondary"]:disabled:hover {
  background: transparent; border-color: transparent; color: var(--text-2);
}

/* ---- Inputs (SQL editor) ---------------------------------------- */
[data-testid="stTextArea"] > div,
[data-testid="stTextInput"] > div {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-ctl);
}
[data-testid="stTextArea"] textarea,
[data-testid="stTextInput"] input {
  color: var(--text);
  font-family: var(--font-sql);
  font-size: 0.95rem; line-height: 1.65;
}
[data-testid="stTextArea"] textarea {
  padding: 0.8rem 0.95rem; min-height: 8.5rem; resize: vertical;
}
[data-testid="stTextArea"] textarea::placeholder { color: var(--text-2); }
[data-testid="stTextArea"] > div:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 32%, transparent);
}

/* ---- Cards: workspace + tutor ------------------------------------ */
[data-testid="stColumn"]:has([data-testid="stTextArea"])
  > [data-testid="stVerticalBlock"],
[data-testid="stColumn"]:has([data-testid="stTextArea"])
  + [data-testid="stColumn"] > [data-testid="stVerticalBlock"] {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 1.35rem 1.5rem 1.5rem;
}

/* ---- Editor head ------------------------------------------------- */
.editor-head {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 0.65rem; margin-bottom: 0.85rem;
  border-bottom: 1px solid var(--border);
}
.editor-title {
  font-family: var(--font-sql); font-size: 0.78rem; font-weight: 600;
  letter-spacing: 0.07em; color: var(--text-2);
}

/* ---- Question header --------------------------------------------- */
.q-title {
  font-size: 1.5rem; font-weight: 650; letter-spacing: -0.015em;
  line-height: 1.3; margin: 0.1rem 0 0.55rem; color: var(--text);
}
.q-instructions {
  font-size: 0.92rem; line-height: 1.55; color: var(--text-2);
  max-width: 74ch; margin: 0 0 1.5rem;
}

/* ---- Status alerts (submission results) --------------------------- */
.alert {
  display: flex; gap: 0.7rem; align-items: flex-start;
  padding: 0.8rem 1rem; border-radius: 10px; border: 1px solid;
  font-size: 0.92rem; line-height: 1.55;
}
.alert-icon {
  flex: 0 0 auto; font-size: 0.95rem; line-height: 1.5; font-weight: 700;
}
.alert-ok {
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 32%, transparent);
  color: var(--text);
}
.alert-ok .alert-icon, .alert-ok strong { color: var(--success); }
.alert-err {
  background: var(--error-soft);
  border-color: color-mix(in srgb, var(--error) 32%, transparent);
  color: var(--text);
}
.alert-err .alert-icon, .alert-err strong { color: var(--error); }
.alert strong { font-weight: 650; }

/* ---- Expanders (schema, earlier attempts) ------------------------- */
[data-testid="stExpander"] {
  background: transparent;
  border: none;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}
[data-testid="stExpander"] summary {
  color: var(--text); font-weight: 500; font-size: 0.88rem;
  background: transparent; border-radius: 6px;
  padding: 0.65rem 0.2rem;
}
[data-testid="stExpander"] summary:hover,
[data-testid="stExpander"] summary:focus-visible {
  background: var(--accent-soft);
}

/* ---- Tutor panel -------------------------------------------------- */
.tutor-head {
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-2);
  margin-bottom: 0.9rem; padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--border);
}
.msg-label {
  font-size: 0.74rem; font-weight: 600; letter-spacing: 0.06em;
  color: var(--accent);
  margin-bottom: 0.4rem;
}
.turn-meta { margin: 0.6rem 0 1rem; }
.turn-meta small { font-size: 0.8rem; color: var(--text-2); }

/* ---- Panels, hairline, global states ------------------------------ */
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 1.5rem 1.75rem;
}
.panel h3:first-child { margin-top: 0; }
.panel p {
  color: var(--text-2); line-height: 1.6; margin-bottom: 0;
}
.panel strong { color: var(--text); }
.panel code {
  font-family: var(--font-sql); font-size: 0.88em;
  background: var(--code-bg); border: 1px solid var(--border);
  border-radius: 4px; padding: 0.05em 0.35em;
}
.panel-compact { padding: 1.1rem 1.2rem; }
.hairline {
  border: 0; border-top: 1px solid var(--border);
  margin: 0.35rem 0 1.3rem;
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
::selection {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}
* { scrollbar-width: thin; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text) 22%, transparent);
  border-radius: 6px; border: 2px solid transparent;
  background-clip: content-box;
}

/* ---- Streamlit built-in alert (Progress empty state) -------------- */
[data-testid="stAlert"] {
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 10px;
  color: var(--text);
  font-size: 0.92rem;
}
[data-testid="stAlert"] [data-testid^="stAlertContent"],
[data-testid="stAlert"] [data-testid="stMarkdownContainer"] {
  color: var(--text);
}
[data-testid="stAlert"] [data-testid="stAlertContainer"] {
  background: transparent;
  color: var(--text);
}

/* ---- Code blocks -------------------------------------------------- */
[data-testid="stCodeBlock"],
[data-testid="stMarkdownPre"] {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-ctl);
}
[data-testid="stCodeBlock"] code,
[data-testid="stMarkdownPre"] code {
  color: var(--text); font-family: var(--font-sql);
}
[data-testid="stMarkdownContainer"] p code,
[data-testid="stMarkdownContainer"] li code,
[data-testid="stMarkdownContainer"] td code {
  background: var(--code-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 0.05em 0.35em; font-family: var(--font-sql);
}

/* ---- Question navigation pills ------------------------------------- */
[data-testid="stPills"],
[data-testid="stButtonGroup"] {
  display: flex; flex-wrap: wrap; gap: 0.4rem;
}
[data-testid="stPills"] label,
[data-testid="stPills"] button,
[data-testid="stButtonGroup"] button {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.38rem 0.8rem; border-radius: var(--radius-ctl);
  border: 1px solid var(--border);
  background: var(--surface); color: var(--text-2);
  font-size: 0.88rem; font-weight: 500; cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease,
              color 0.12s ease;
}
[data-testid="stPills"] label *,
[data-testid="stPills"] button *,
[data-testid="stButtonGroup"] button * { color: inherit; }
[data-testid="stButtonGroup"] button[data-focus-visible] {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent);
}
[data-testid="stPills"] label:hover,
[data-testid="stPills"] button:hover,
[data-testid="stButtonGroup"] button:not([data-selected]):is(:hover, [data-hovered], [data-focus-visible]):not([data-disabled]) {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  color: var(--text);
}
[data-testid="stPills"] label:has(input:checked),
[data-testid="stPills"] button[aria-pressed="true"],
[data-testid="stButtonGroup"] button[data-selected]:not([data-disabled]) {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent); font-weight: 600;
}
[data-testid="stButtonGroup"] button[data-selected]:is(:hover, [data-hovered], [data-focus-visible]):not([data-disabled]) {
  background: color-mix(in srgb, var(--accent) 86%, var(--text));
  border-color: color-mix(in srgb, var(--accent) 86%, var(--text));
  color: var(--on-accent); font-weight: 600;
}
/* Held-out group: quieter at rest so the two groups read differently. */
.st-key-qnav_held [data-testid="stButtonGroup"] button:not([data-selected]) {
  background: transparent;
}
.st-key-qnav_held [data-testid="stButtonGroup"] button:not([data-selected]):is(:hover, [data-hovered], [data-focus-visible]):not([data-disabled]) {
  background: var(--accent-soft);
  color: var(--text);
}

/* ---- Progress: summary, timeline, sections ------------------------- */
.stats {
  display: flex; flex-wrap: wrap; gap: 0.9rem 1.8rem;
  margin: 0.3rem 0 0.7rem;
}
.stat {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 0.7rem 1.1rem; min-width: 9rem;
}
.stat-value {
  font-size: 1.3rem; font-weight: 650; color: var(--text);
  line-height: 1.25;
}
.stat-label {
  font-size: 0.74rem; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-2); margin-top: 0.2rem;
}
.summary-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 1.1rem 1.5rem;
  align-items: stretch;
}
.summary-card .stat {
  background: transparent; border: none;
  padding: 0.15rem 1.6rem; min-width: 0;
  border-left: 1px solid var(--border);
}
.summary-card .stat:first-child {
  border-left: none; padding-left: 0.15rem;
}
.summary-card .stat-value { font-size: 1.3rem; }
.summary-card .stat:first-child .stat-value {
  font-size: 2rem; color: var(--accent);
}
.section-head {
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.07em;
  text-transform: uppercase; color: var(--text-2);
  margin: 1.7rem 0 0.6rem;
}
.act-list {
  position: relative;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 0.35rem 1.3rem;
}
.act-list::before {
  content: ""; position: absolute;
  left: 1.78rem; top: 1.6rem; bottom: 1.6rem;
  width: 1px; background: var(--border);
}
.act-row {
  position: relative;
  display: flex; flex-wrap: wrap; gap: 0.25rem 0.9rem;
  align-items: baseline; padding: 0.7rem 0 0.7rem 1.6rem;
  border-bottom: 1px solid var(--border);
}
.act-row:last-child { border-bottom: none; }
.act-row::before {
  content: ""; position: absolute;
  left: 0.16rem; top: 1.08rem;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--text-2);
}
.act-row:has(.tag-ok)::before {
  background: var(--success); border-color: var(--success);
}
.act-time {
  font-family: var(--font-sql); font-size: 0.82rem;
  color: var(--text-2); min-width: 4.6rem;
}
.act-q { flex: 1 1 14rem; font-size: 0.92rem; color: var(--text); }
.tag-ok { color: var(--success); font-weight: 600; font-size: 0.88rem; }
.tag-miss { color: var(--text-2); font-weight: 500; font-size: 0.88rem; }
.act-meta { font-size: 0.82rem; color: var(--text-2); }
/* Grouped question lists (needs-look / not-yet-attempted): the markdown
   list directly following a section head sits on a soft card surface. */
div[data-testid="stElementContainer"]:has(> div[data-testid="stMarkdown"] [data-testid="stMarkdownContainer"] > div.section-head)
  + div[data-testid="stElementContainer"] [data-testid="stMarkdownContainer"] > ul {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding-block: 0.7rem 0.85rem;
  padding-inline-end: 1.3rem;
  margin-top: 0.3rem;
}

/* ---- Settings: theme option rows ----------------------------------- */
.theme-rows {
  display: flex; flex-direction: column; gap: 0.5rem;
  margin-top: 1.1rem;
}
.theme-row {
  display: flex; align-items: baseline; gap: 0.85rem;
  padding: 0.72rem 0.95rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}
.theme-row.active {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--accent-soft);
}
.theme-name {
  font-weight: 600; font-size: 0.92rem; color: var(--text);
  min-width: 4.4rem;
}
.theme-desc {
  font-size: 0.86rem; color: var(--text-2); flex: 1; line-height: 1.5;
}
.theme-badge {
  font-size: 0.66rem; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--accent);
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  padding: 0.16rem 0.5rem; border-radius: 999px;
  white-space: nowrap;
}

/* ---- Responsive / accessibility --------------------------------- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition: none !important; animation: none !important;
  }
}
@media (max-width: 768px) {
  [data-testid="stMainBlockContainer"] {
    padding: 1rem 1.1rem 2.5rem;
  }
  [data-testid="stMain"] [data-testid="stRadio"] div[role="radiogroup"] {
    justify-content: flex-start;
  }
  .panel { padding: 1.1rem 1.15rem; }
  .panel-compact { padding: 0.95rem 1.05rem; }
  [data-testid="stTextArea"] textarea { min-height: 7rem; }
  .q-title { font-size: 1.2rem; }
  .summary-card { padding: 0.9rem 1.1rem; }
  .summary-card .stat {
    border-left: none; padding: 0.2rem 1rem 0.2rem 0;
  }
  .summary-card .stat:first-child .stat-value { font-size: 1.7rem; }
  .alert { padding: 0.7rem 0.85rem; }
  .act-list { padding: 0.35rem 1rem; }
  .act-list::before { left: 1.48rem; }
}
"""


def _token_block(tokens: dict) -> str:
    return "\n".join(f"  --{name}: {value};" for name, value in tokens.items())


def build_theme_css(mode: str) -> str:
    """Return the full CSS layer for the chosen theme mode.

    System mode injects light tokens as the base and dark tokens under
    a prefers-color-scheme media query, so the OS preference is followed
    live with no JavaScript.
    """
    if mode == "Dark":
        root_block, media_block = _token_block(DARK), ""
    elif mode == "Light":
        root_block, media_block = _token_block(LIGHT), ""
    else:  # System
        root_block = _token_block(LIGHT)
        media_block = (
            "\n@media (prefers-color-scheme: dark) {\n  :root {\n"
            + _token_block(DARK)
            + "\n  }\n}\n"
        )

    scheme = {"Light": "light", "Dark": "dark"}.get(mode, "light dark")
    root_css = (
        f":root {{ color-scheme: {scheme};\n{root_block}{_EXTRA_TOKENS}}}{media_block}"
    )
    font_import = (
        "@import url('https://fonts.googleapis.com/css2?"
        "family=Inter:wght@400;500;600&display=swap');\n"
    )
    return font_import + root_css + _COMPONENT_CSS


# ------------------------------------------------------------------
# Page setup (set_page_config must be the first Streamlit command)
# ------------------------------------------------------------------

st.set_page_config(
    page_title="Learning OS",
    page_icon=":material/school:",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ------------------------------------------------------------------
# Session state
# ------------------------------------------------------------------

if "theme" not in st.session_state:
    seed = str(st.query_params.get("theme", "system")).strip().lower()
    st.session_state.theme = (
        seed.capitalize() if seed.capitalize() in THEMES else "System"
    )

if "destination" not in st.session_state:
    st.session_state.destination = "Learn"

if "activity" not in st.session_state:
    # Real per-question activity, written only by actual submissions
    # (Stage C/D). Empty until the learner submits SQL.
    st.session_state.activity = {}

if "current_qid" not in st.session_state:
    st.session_state.current_qid = PRACTICE_IDS[0]

if "sql_drafts" not in st.session_state:
    # Per-question SQL drafts. The textarea widget key holds the live
    # value while a question is on screen; this dict is the persistent
    # copy (widget state is pruned when the widget unmounts on switch).
    st.session_state.sql_drafts = {}

if "tutor_state" not in st.session_state:
    # Per-question tutor state: {qid: {history, attempts, gave_up,
    # turns, last_error}}. One isolated dict per question — histories
    # are never shared between questions.
    st.session_state.tutor_state = {}

if "last_submit_sig" not in st.session_state:
    # Duplicate-submission guard: (signature, monotonic_time).
    st.session_state.last_submit_sig = None

if "activity_log" not in st.session_state:
    # Chronological record of successfully processed submissions
    # (Stage D): qid, title, correct, attempt, hint_level, gave_up,
    # timestamp. Never stores SQL text or reference solutions, and is
    # only appended after a backend turn succeeds.
    st.session_state.activity_log = []

# ------------------------------------------------------------------
# Theme layer
# ------------------------------------------------------------------

st.markdown(
    f"<style>{build_theme_css(st.session_state.theme)}</style>",
    unsafe_allow_html=True,
)

# ------------------------------------------------------------------
# Application header: brand + compact theme control
# ------------------------------------------------------------------

brand_col, theme_col = st.columns([3, 2], vertical_alignment="center")
with brand_col:
    st.markdown(
        '<div class="brand"><span class="brand-name">Learning OS</span>'
        '<span class="brand-sub">SQL practice tutor</span></div>',
        unsafe_allow_html=True,
    )
with theme_col:
    st.radio(
        "Theme",
        list(THEMES),
        key="theme",
        horizontal=True,
        label_visibility="collapsed",
    )

# Keep the choice in the URL so it survives future visits (zero-dep).
try:
    chosen = st.session_state.theme.lower()
    if str(st.query_params.get("theme", "")).lower() != chosen:
        st.query_params["theme"] = chosen
except Exception:
    pass

st.markdown('<hr class="hairline">', unsafe_allow_html=True)

# ------------------------------------------------------------------
# Sidebar navigation
# ------------------------------------------------------------------

with st.sidebar:
    st.radio(
        "Navigation",
        ["Learn", "Progress", "Settings"],
        key="destination",
        label_visibility="collapsed",
    )

# ------------------------------------------------------------------
# Destinations — only real content, no invented data
# ------------------------------------------------------------------


def _render_question_nav() -> int:
    """Grouped pills navigation (Practice / Held out); returns qid.

    Exactly one group holds the selection: the inactive group's widget
    state is cleared before it is instantiated, so only the current
    group shows a highlighted pill.
    """
    prev = st.session_state.current_qid
    prev_p = prev if prev in PRACTICE_IDS else None
    prev_h = prev if prev in HELD_IDS else None
    clicked_p = st.session_state.get("qnav_practice")
    clicked_h = st.session_state.get("qnav_held")
    if clicked_h is not None and clicked_h != prev_h:
        current = clicked_h
    elif clicked_p is not None and clicked_p != prev_p:
        current = clicked_p
    else:
        current = prev
    if current not in QUESTIONS:
        current = PRACTICE_IDS[0]
    st.session_state.current_qid = current

    st.session_state.qnav_practice = current if current in PRACTICE_IDS else None
    st.session_state.qnav_held = current if current in HELD_IDS else None

    practice_col, held_col = st.columns([5, 3], gap="small")
    with practice_col:
        st.markdown('<div class="nav-eyebrow">Practice</div>',
                    unsafe_allow_html=True)
        st.pills(
            "Practice",
            options=PRACTICE_IDS,
            format_func=lambda qid: f"Q{qid}",
            key="qnav_practice",
            wrap=True,
            label_visibility="collapsed",
        )
    with held_col:
        st.markdown('<div class="nav-eyebrow">Held out</div>',
                    unsafe_allow_html=True)
        st.pills(
            "Held out",
            options=HELD_IDS,
            format_func=lambda qid: f"Q{qid}",
            key="qnav_held",
            wrap=True,
            label_visibility="collapsed",
        )
    return current


def _render_schema_panel() -> None:
    with st.expander("Database schema · 2 tables", key="schema_panel"):
        for table, columns in SCHEMA_TABLES:
            st.markdown(f"**{table}**")
            rows = "\n".join(f"| `{name}` | {type_} |" for name, type_ in columns)
            st.markdown("| Column | Type |\n|---|---|\n" + rows)
        foreign_keys = ", ".join(
            f"`{source}` → `{target}`" for source, target in SCHEMA_FOREIGN_KEYS
        )
        st.caption(f"Foreign key: {foreign_keys}")


def _tstate(qid: int) -> dict:
    """Isolated tutor state for one question (created on first use)."""
    state = st.session_state.tutor_state
    if qid not in state:
        state[qid] = {
            "history": [],
            "attempts": 0,
            "gave_up": False,
            "turns": [],
            "last_error": None,
        }
    return state[qid]


def _friendly_error(exc: Exception) -> str:
    """Learner-safe message for a failed turn. Never includes the raw
    exception (it may carry connection strings or stack details)."""
    module = type(exc).__module__ or ""
    if "groq" in module:
        return (
            "The tutor service could not be reached. Your SQL, history "
            "and attempt count are unchanged — try Submit again."
        )
    if module.startswith("psycopg"):
        return (
            "The practice database is unavailable right now. Your SQL, "
            "history and attempt count are unchanged — try again shortly."
        )
    return (
        "Something went wrong running this submission. Your SQL, history "
        "and attempt count are unchanged — try again."
    )


def _run_turn(qid: int, learner_sql: str, is_give_up: bool) -> bool:
    """One deliberate backend turn (checker + tutor). Commits state only
    on success. Returns False when the click was a duplicate."""
    stt = _tstate(qid)

    if is_give_up and stt["gave_up"]:
        # Already given up — the button is disabled from the next
        # render; never run a second give-up turn.
        return True

    now = time.monotonic()
    signature = (qid, learner_sql.strip(), is_give_up)
    previous = st.session_state.last_submit_sig
    if (
        previous is not None
        and previous[0] == signature
        and now - previous[1] < 1.5
    ):
        return False

    attempt_no = stt["attempts"] + 1

    # Lazy import: ordinary navigation/typing never loads the tutor
    # (and a missing API key cannot break the rest of the app).
    try:
        from tutor import run_tutor_turn
    except Exception as exc:
        traceback.print_exc()
        if isinstance(exc, KeyError):
            stt["last_error"] = (
                "The tutor is missing its API-key configuration on the "
                "server. Nothing was submitted — your SQL and attempt "
                "count are unchanged."
            )
        else:
            stt["last_error"] = (
                "The tutor library could not be loaded. Nothing was "
                "submitted — your SQL and attempt count are unchanged."
            )
        st.session_state.last_submit_sig = None
        return True

    try:
        with st.spinner("Checking your query and asking the tutor…"):
            reply, new_history, tool_result = run_tutor_turn(
                question_id=qid,
                question_text=QUESTIONS[qid]["question"],
                schema_hint=SCHEMA_HINT,
                learner_sql=learner_sql,
                history=stt["history"],
                attempt_number=attempt_no,
                gave_up=is_give_up or stt["gave_up"],
            )
    except Exception as exc:
        traceback.print_exc()
        stt["last_error"] = _friendly_error(exc)
        st.session_state.last_submit_sig = None
        return True

    correct = bool(tool_result.get("correct"))
    reason = tool_result.get("reason") or ("ok" if correct else "unknown")
    stt["history"] = new_history
    stt["attempts"] = attempt_no
    if is_give_up:
        stt["gave_up"] = True
    stt["turns"].append(
        {
            "attempt": attempt_no,
            "correct": correct,
            "hint_level": tool_result.get("hint_level"),
            "reason": reason,
            "reason_label": _REASON_LABELS.get(reason, reason),
            "gave_up": is_give_up,
            "reply": reply,
        }
    )
    stt["last_error"] = None
    # Record the signature only after a successful turn, so a run that is
    # interrupted mid-turn can never leave a stale signature behind and
    # block the user's genuine next submission.
    st.session_state.last_submit_sig = (signature, time.monotonic())
    st.session_state.activity[qid] = {
        "status": "Correct" if correct else f"Incorrect · attempt {attempt_no}",
    }
    st.session_state.activity_log.append(
        {
            "qid": qid,
            "title": QUESTIONS[qid]["question"],
            "correct": correct,
            "attempt": attempt_no,
            "hint_level": tool_result.get("hint_level"),
            "gave_up": is_give_up,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }
    )
    return True


def _render_status_strip(stt: dict) -> None:
    """Latest submission status: checker banner + attempt/hint meta.

    Rendered in the workspace column next to the editor (submission
    status belongs to the editor), keeping the tutor column purely for
    tutor messages. Text matches the earlier Streamlit banners exactly.
    """
    latest = stt["turns"][-1]
    if latest["correct"]:
        st.markdown(
            '<div class="alert alert-ok"><span class="alert-icon" '
            'aria-hidden="true">\u2713</span><div>'
            "<strong>Checker: correct</strong> \u2014 the result matches "
            "the expected answer.</div></div>",
            unsafe_allow_html=True,
        )
    else:
        reason = html.escape(latest["reason_label"])
        st.markdown(
            f'<div class="alert alert-err"><span class="alert-icon" '
            f'aria-hidden="true">\u2715</span><div>'
            f"<strong>Checker: incorrect</strong> \u2014 {reason}."
            f"</div></div>",
            unsafe_allow_html=True,
        )

    level = latest["hint_level"]
    if level == 0:
        meta = f"Attempt {latest['attempt']} \u00b7 hint level 0 \u2014 correct"
    elif level is None:
        meta = f"Attempt {latest['attempt']}"
    else:
        meta = f"Attempt {latest['attempt']} \u00b7 hint level {level} of 4"
    if latest["gave_up"] and not latest["correct"]:
        meta += " \u00b7 given up"
    st.markdown(
        f'<div class="turn-meta"><small>{html.escape(meta)}</small></div>',
        unsafe_allow_html=True,
    )


def _render_tutor_panel(qid: int) -> None:
    stt = _tstate(qid)
    st.markdown('<div class="tutor-head">AI tutor</div>', unsafe_allow_html=True)

    if stt["last_error"]:
        st.markdown(
            f'<div class="alert alert-err"><span class="alert-icon" '
            f'aria-hidden="true">\u2715</span><div>'
            f"{html.escape(stt['last_error'])}</div></div>",
            unsafe_allow_html=True,
        )

    if not stt["turns"]:
        st.markdown(
            '<div class="panel panel-compact">'
            "<p>Submit your SQL to get checker-backed feedback, "
            "progressive hints and \u2014 after Give Up \u2014 the reference "
            "solution.</p>"
            "</div>",
            unsafe_allow_html=True,
        )
        if stt["gave_up"]:
            st.caption("You gave up on this question.")
        return

    latest = stt["turns"][-1]
    st.markdown('<div class="msg-label">Tutor</div>', unsafe_allow_html=True)
    st.markdown(latest["reply"] or "*(the tutor returned no text)*")

    earlier = stt["turns"][:-1]
    if earlier:
        with st.expander(f"Earlier attempts ({len(earlier)})"):
            for turn in earlier:
                outcome = "correct" if turn["correct"] else "incorrect"
                turn_level = (
                    "correct" if turn["hint_level"] == 0
                    else f"hint {turn['hint_level']}"
                )
                st.caption(
                    f"Attempt {turn['attempt']} \u00b7 {outcome} \u00b7 {turn_level}"
                )
                st.markdown(turn["reply"] or "*(the tutor returned no text)*")

    if stt["gave_up"]:
        st.caption(
            "You gave up on this question \u2014 the reference solution stays "
            "available here."
        )


def render_learn() -> None:
    current = _render_question_nav()
    question = QUESTIONS[current]
    purpose = "Practice" if question["purpose"] == "practice" else "Held out"
    st.markdown('<hr class="hairline">', unsafe_allow_html=True)

    # Question header (navigation/question area, full width)
    st.markdown(
        f'<div class="q-eyebrow">Question {current} of {len(QUESTIONS)} '
        f"\u00b7 {purpose}</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        f'<h2 class="q-title">{html.escape(question["question"])}</h2>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<div class="q-instructions">One checker run and one tutor reply '
        "per submission. Your SQL is never modified by the tutor.</div>",
        unsafe_allow_html=True,
    )

    workspace_col, tutor_col = st.columns([7, 5], gap="large")
    with workspace_col:
        _render_schema_panel()

        st.markdown(
            '<div class="editor-head"><span class="editor-title">'
            "SQL editor</span></div>",
            unsafe_allow_html=True,
        )
        editor_key = f"sql_editor_{current}"
        if editor_key not in st.session_state:
            st.session_state[editor_key] = st.session_state.sql_drafts.get(
                current, ""
            )
        st.text_area(
            "SQL editor",
            key=editor_key,
            height=360,
            placeholder="SELECT \u2026",
            label_visibility="collapsed",
        )
        st.session_state.sql_drafts[current] = st.session_state[editor_key]
        draft = st.session_state.sql_drafts[current]
        stt = _tstate(current)

        submit_col, giveup_col = st.columns([3, 2], gap="small")
        with submit_col:
            submit_click = st.button(
                "Submit SQL",
                type="primary",
                width="stretch",
                disabled=not draft.strip(),
                help="Type a query first." if not draft.strip() else None,
            )
        with giveup_col:
            give_up_click = st.button(
                "Give Up",
                type="secondary",
                width="stretch",
                disabled=stt["gave_up"],
                help="Skip straight to the reference solution.",
            )
        if submit_click:
            duplicate = not _run_turn(current, draft, is_give_up=False)
        elif give_up_click:
            duplicate = not _run_turn(current, draft, is_give_up=True)
            if not duplicate:
                # The Give Up button above was created before this click
                # processed; rerun once so it renders disabled now instead
                # of waiting for the next unrelated interaction.
                st.rerun()
        else:
            duplicate = False

        if stt["turns"]:
            _render_status_strip(stt)
        if duplicate:
            st.caption(
                "Duplicate submission ignored \u2014 the same query was just "
                "processed."
            )
        if stt["attempts"]:
            st.caption(f"Attempts on this question: {stt['attempts']}")
    with tutor_col:
        _render_tutor_panel(current)


def _stat_html(value: str, label: str) -> str:
    return (
        '<div class="stat">'
        f'<div class="stat-value">{html.escape(value)}</div>'
        f'<div class="stat-label">{html.escape(label)}</div>'
        "</div>"
    )


def _activity_list_html(records: list) -> str:
    rows = []
    for r in records:  # newest first
        when = datetime.fromisoformat(r["timestamp"]).strftime("%H:%M:%S")
        result = "Correct" if r["correct"] else "Incorrect"
        tag_cls = "tag-ok" if r["correct"] else "tag-miss"
        hint = (
            str(r["hint_level"]) if r["hint_level"] is not None else "?"
        )
        meta = f"attempt {r['attempt']} · hint {hint}"
        if r["gave_up"]:
            meta += " · gave up"
        rows.append(
            '<div class="act-row">'
            f'<span class="act-time">{when}</span>'
            f'<span class="act-q">Q{r["qid"]} · '
            f'{html.escape(r["title"])}</span>'
            f'<span class="{tag_cls}">{result}</span>'
            f'<span class="act-meta">{html.escape(meta)}</span>'
            "</div>"
        )
    return '<div class="act-list">' + "".join(rows) + "</div>"


def render_progress() -> None:
    st.markdown('<div class="page-title">Progress</div>',
                unsafe_allow_html=True)
    st.caption(
        "Session-only: this page reflects submissions in this browser "
        "\u2014 a refresh starts over."
    )
    log = st.session_state.activity_log

    solved_ids = {r["qid"] for r in log if r["correct"]}
    attempted_ids = {r["qid"] for r in log}
    attempted = [qid for qid in QUESTIONS if qid in attempted_ids]
    unsolved = [qid for qid in attempted if qid not in solved_ids]
    not_attempted = [
        qid for qid in QUESTIONS if qid not in attempted_ids
    ]

    if not log:
        st.info(
            "No submissions yet. Submit SQL in the Learn workspace to "
            "see attempted and solved questions here. Progress is "
            "session-only."
        )
    else:
        # One summary surface with four metrics: the solved count leads,
        # the rest stay compact (no row of identical cards).
        st.markdown(
            '<div class="stats summary-card">'
            + _stat_html(f"{len(attempted)} of {len(QUESTIONS)}",
                         "Questions attempted")
            + _stat_html(f"{len(solved_ids)} of {len(QUESTIONS)}", "Solved")
            + _stat_html(str(len(log)), "Submissions")
            + _stat_html(str(len(not_attempted)), "Not yet attempted")
            + "</div>",
            unsafe_allow_html=True,
        )
        st.caption(
            "Attempted = at least one processed submission \u00b7 "
            "Solved = at least one checker-confirmed correct submission \u00b7 "
            "Failed requests are not counted."
        )
        st.markdown('<div class="section-head">Recent activity</div>',
                    unsafe_allow_html=True)
        st.markdown(_activity_list_html(list(reversed(log))),
                    unsafe_allow_html=True)

    if unsolved:
        st.markdown('<div class="section-head">Needs another look</div>',
                    unsafe_allow_html=True)
        items = []
        for qid in unsolved:
            recs = [r for r in log if r["qid"] == qid]
            last_hint = recs[-1]["hint_level"]
            plural = "" if len(recs) == 1 else "s"
            hint_text = last_hint if last_hint is not None else "?"
            items.append(
                f"- **Q{qid}** \u00b7 {QUESTIONS[qid]['question']} \u2014 "
                f"{len(recs)} attempt{plural}, last hint level {hint_text}"
            )
        st.markdown("\n".join(items))

    if not_attempted:
        st.markdown('<div class="section-head">Not yet attempted</div>',
                    unsafe_allow_html=True)
        st.markdown(
            "\n".join(
                f"- **Q{qid}** \u00b7 {QUESTIONS[qid]['question']}"
                for qid in not_attempted
            )
        )


def render_settings() -> None:
    st.markdown('<div class="page-title">Settings</div>',
                unsafe_allow_html=True)
    n_practice = sum(
        1 for q in QUESTIONS.values() if q["purpose"] == "practice"
    )
    n_held = len(QUESTIONS) - n_practice

    theme = st.session_state.theme
    theme_options = (
        ("System", "Follows your device\u2019s light or dark setting."),
        ("Light", "Warm off-white background with dark text."),
        ("Dark", "Deep charcoal background with light text."),
    )
    rows_html = "".join(
        f'<div class="theme-row{" active" if name == theme else ""}">'
        f'<span class="theme-name">{name}</span>'
        f'<span class="theme-desc">{desc}</span>'
        + (
            '<span class="theme-badge">Current</span>'
            if name == theme
            else ""
        )
        + "</div>"
        for name, desc in theme_options
    )
    st.markdown(
        '<div class="panel">'
        "<h3>Appearance</h3>"
        f"<p>Theme: <strong>{theme}</strong>. Change it with the Light / "
        "Dark / System control in the header. The choice is kept for this "
        "browsing session and written to the page address \u2014 add "
        "<code>?theme=dark</code> to the URL to restore it on a later "
        "visit.</p>"
        f'<div class="theme-rows">{rows_html}</div>'
        "</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        '<div class="panel">'
        "<h3>About this workspace</h3>"
        f"<p>{len(QUESTIONS)} SQL questions \u2014 {n_practice} practice and "
        f"{n_held} held out for the removal test. Every submission is "
        "executed and compared against reference results by Python on "
        "Supabase PostgreSQL; the language model only writes the "
        "explanations. Correctness, hint levels and answer disclosure are "
        "never decided by the model.</p>"
        "</div>",
        unsafe_allow_html=True,
    )


destination = st.session_state.destination
if destination == "Learn":
    render_learn()
elif destination == "Progress":
    render_progress()
else:
    render_settings()
