import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ retries: 0 });

// ---------------------------------------------------------------------------
// Readiness helpers — every wait targets a real application condition.
// No `waitForLoadState('networkidle')` (flaky with dev HMR + Monaco) and no
// `waitForTimeout` sleeps. Timeouts are Playwright defaults (5 s) except where
// the backend LLM turn legitimately needs longer (60 s).
// ---------------------------------------------------------------------------

/** Learn page ready = server meta rendered (Q1 nav visible). */
async function waitForLearnReady(page: Page) {
  await page.goto('/');
  // Scope to <main> (Next.js dev flight payload keeps a hidden copy).
  // 30 s page-load budget matches the original suite's meta wait (dev
  // Turbopack compile + server meta fetch); in-page assertions stay at 5 s.
  await expect(page.locator('main').getByTestId('learn-workspace')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });
}

/** Monaco editor ready = mounted flag set by the app (real editor state). */
async function waitForMonacoReady(page: Page) {
  await expect(page.locator('main').locator('[data-monaco-ready="true"]')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
}

/**
 * Type SQL as a real user would: focus the editor, select-all, then type.
 * The delay is input pacing for editor reliability, not a sleep wait.
 *
 * Hardened for parallel-worker load: Monaco occasionally drops a keystroke
 * (the controlled value update races the next key), which corrupts the SQL —
 * silently, because a garbled query still returns "Incorrect". So the helper
 * waits for the editor's input to actually hold focus, then verifies the real
 * editor state and retypes until it matches (bounded).
 */
async function typeSql(page: Page, sql: string, clear = false) {
  await waitForMonacoReady(page);
  await page.locator('.monaco-editor').click();
  // Focus hand-off: typing before the editor takes focus drops the first
  // keystroke(s). Monaco here uses the EditContext API — focus lands on a
  // div inside the editor, not on a textarea (a bare `textarea` selector
  // would match only the read-only IME helper, which never takes focus).
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.monaco-editor')))
    .toBe(true);
  const editorText = page.locator('.monaco-editor .view-lines');
  // Monaco renders plain spaces as &nbsp; (U+00A0) in the view layer.
  const readEditor = async () =>
    ((await editorText.textContent()) ?? '').replace(/\u00A0/g, ' ');
  for (let attempt = 0; attempt < 3; attempt++) {
    // Always select-all first: replaces any partially-typed (possibly
    // corrupted) content, including when the caller passed clear=false.
    if (attempt > 0 || clear) {
      await page.keyboard.press('ControlOrMeta+A');
    }
    await page.keyboard.type(sql, { delay: 30 });
    if ((await readEditor()) === sql) return;
  }
  // Final attempt exhausted: fail with the real editor state in the diff.
  expect(await readEditor()).toBe(sql);
}

test.describe('Learn workspace — complete flow', () => {
  test.beforeEach(async ({ page }) => {
    await waitForLearnReady(page);
  });

  test('loads Learn page with question navigation', async ({ page }) => {
    // Slice A: the question itself is the page's top-level heading.
    await expect(page.locator('main').getByTestId('question-text')).toBeVisible();
    await expect(page.locator('main').locator('h1')).toContainText(/\w+/);
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('main').getByTestId('qnav-Q8')).toBeVisible();
    // No group labels, no idle tutor block, no internal-state meta or
    // developer hint-context anywhere on the page.
    await expect(page.locator('main')).not.toContainText('Practice');
    await expect(page.locator('main')).not.toContainText('Held out');
    await expect(page.locator('main').getByTestId('tutor-panel')).toHaveCount(0);
    await expect(page.locator('main').getByTestId('turn-meta')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Hint context');
    await expect(page.locator('main')).not.toContainText('Attempt 0');
  });

  test('navigates between questions', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await expect(page.locator('main').locator('p.eyebrow:has-text("Question 1 of 8")')).toBeVisible();

    await page.locator('main').getByTestId('qnav-Q2').click();
    await expect(page.locator('main').locator('p.eyebrow:has-text("Question 2 of 8")')).toBeVisible();

    await page.locator('main').getByTestId('qnav-Q3').click();
    await expect(page.locator('main').locator('p.eyebrow:has-text("Question 3 of 8")')).toBeVisible();
  });

  test('opens schema panel', async ({ page }) => {
    await expect(page.locator('main').getByTestId('schema-panel')).toBeVisible();
    // Tables start open on desktop and collapsed on mobile.
    const tables = page.locator('main').getByTestId('schema-tables');
    if (!(await tables.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await tables.locator('summary').click();
    }
    await expect(page.locator('main').getByTestId('schema-table-customers')).toBeVisible();
    await expect(page.locator('main').getByTestId('schema-table-orders')).toBeVisible();
    const foreignKeys = page.locator('main').getByTestId('schema-fks');
    if (!(await foreignKeys.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await foreignKeys.locator('summary').click();
    }
    await expect(foreignKeys).toContainText('customer_id');
  });

  test('enters SQL in Monaco editor', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, "SELECT * FROM customers WHERE city = 'Bengaluru';");
    await expect(page.locator('main').getByTestId('sql-editor')).toContainText('Bengaluru');
  });

  test('submits correct SQL and receives checker result + tutor response', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q2').click();
    await typeSql(page, 'SELECT COUNT(*) FROM orders;');

    await page.locator('main').getByTestId('submit-sql').click();
    // Real app conditions: status banner + turn meta + tutor reply.
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Correct', { timeout: 60000 });
    // Slice B: the near-action status line connects the outcome to the action.
    await expect(page.locator('main').getByTestId('submit-status')).toContainText('Correct.', { timeout: 60000 });
    // First submission on this question: the meta line must read Attempt 1.
    await expect(page.locator('main').getByTestId('turn-meta')).toContainText('Attempt 1', { timeout: 60000 });
    await expect(page.locator('main').getByTestId('tutor-reply')).toBeVisible({ timeout: 60000 });
  });

  test('submits incorrect SQL and receives checker result + tutor response', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');

    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Not quite', { timeout: 60000 });
    await expect(page.locator('main').getByTestId('submit-status')).toContainText('Not quite yet', { timeout: 60000 });
    // Turn meta is orientation only (earlier attempts use a different shape,
    // so no strict-mode ambiguity). Attempt 1 — not the double-counted
    // "Attempt 2" (current turn counted twice, audit §1.3).
    // Note: separate toContainText calls — Playwright's array form is
    // line-wise equality, not "contains all substrings".
    await expect(page.locator('main').getByTestId('turn-meta')).toContainText('Attempt 1', { timeout: 60000 });
    // hint_level selects learner language; the phrase is merged into the meta line.
    await expect(page.locator('main').getByTestId('turn-meta')).toContainText('A small nudge', { timeout: 60000 });
    // The meta line is UI-controlled: implementation language never renders.
    await expect(page.locator('main').getByTestId('turn-meta')).not.toContainText('hint level');
  });

  test('progressive guidance on repeated incorrect submissions', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();

    // hint_level 1–4 maps to learner-facing guidance phrases (the number
    // itself is never rendered).
    const phrases = ['A small nudge', 'A stronger clue', "Here's the key idea", 'The full solution'];
    const attempts = ['SELECT 13;', 'SELECT 14;', 'SELECT 15;', 'SELECT 16;'];
    for (let i = 0; i < attempts.length; i++) {
      await typeSql(page, attempts[i], i > 0);
      await page.locator('main').getByTestId('submit-sql').click();
      await expect(page.locator('main').getByTestId('turn-meta')).toContainText(`Attempt ${i + 1}`, { timeout: 60000 });
      await expect(page.locator('main').getByTestId('turn-meta')).toContainText(phrases[i], { timeout: 60000 });
      await expect(page.locator('main').getByTestId('turn-meta')).not.toContainText('hint level');
    }
  });

  test('Give up discloses reference SQL', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await waitForMonacoReady(page);

    await page.locator('main').getByTestId('give-up').click();
    // Real disclosure conditions: the single gave-up state appears, the
    // tutor reply renders the reference SQL in a code block, and the
    // button disables.
    await expect(page.locator('main').getByTestId('tutor-gave-up')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('main').getByTestId('tutor-gave-up')).toContainText('reference SQL');
    await expect(page.locator('main').getByTestId('tutor-reply')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('main').getByTestId('tutor-reply').locator('code:has-text("SELECT")').first()).toBeVisible({ timeout: 60000 });
    // No duplicated gave-up notes anywhere in the panel.
    await expect(page.locator('main').getByTestId('tutor-panel')).not.toContainText('is now disclosed');
    await expect(page.locator('main').getByTestId('give-up')).toBeDisabled();
  });

  test('duplicate submission guard works', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');
    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Not quite', { timeout: 60000 });

    // Immediate duplicate (same qid + SQL + Submit within 1.5 s window).
    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('duplicate-caption')).toContainText('Duplicate submission ignored');
  });

  test('shows Checking… while a turn is in flight; one request, actions disabled, SQL preserved', async ({ page }) => {
    // Deterministic: stub the turn with a 1.5 s delay instead of waiting on
    // the LLM, so the in-flight state can be asserted reliably.
    let turnCalls = 0;
    await page.route('**/api/tutor/turn', async (route) => {
      turnCalls += 1;
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Stubbed tutor reply.',
          history: [],
          attempt: 1,
          tool_result: {
            correct: false,
            reason: 'row_count',
            reason_label: 'Different number of rows',
            row_diff: [1, 2],
            hint_level: 1,
            gave_up: false,
          },
        }),
      });
    });

    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');
    await page.locator('main').getByTestId('submit-sql').click();

    const submit = page.locator('main').getByTestId('submit-sql');
    await expect(submit).toHaveText('Checking…');
    await expect(submit).toBeDisabled();
    // No compounding dim on the pending label (daisyUI already dims disabled).
    await expect(submit).toHaveCSS('opacity', '1');
    await expect(page.locator('main').getByTestId('give-up')).toBeDisabled();
    await expect(page.locator('main').getByTestId('submit-status')).toHaveText('Checking your query…');
    // The SQL draft is never cleared or rewritten by the pending turn.
    // Monaco renders spaces as &nbsp; (U+00A0) — normalize before comparing.
    const editorText = await page
      .locator('.monaco-editor .view-lines')
      .evaluate((el) => el.textContent?.replace(/\u00A0/g, ' '));
    expect(editorText).toBe('SELECT 13;');

    // Outcome lands: status line reports it and the action re-enables.
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Not quite', { timeout: 15000 });
    await expect(page.locator('main').getByTestId('submit-status')).toContainText('Not quite yet');
    await expect(submit).toHaveText('Check answer');
    await expect(submit).toBeEnabled();
    expect(turnCalls).toBe(1);
  });
});

test.describe('Progress page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/progress');
    await expect(page.locator('main').locator('h1')).toContainText('This session so far', { timeout: 30000 });
  });

  test('loads Progress page with session-only caption', async ({ page }) => {
    await expect(page.locator('main').locator('h1')).toContainText('This session so far');
    await expect(page.locator('main').locator('text=refresh starts over')).toBeVisible();
  });

  test('shows empty state before any submissions', async ({ page }) => {
    await expect(page.locator('main').locator('text=No submissions yet. Check answer')).toBeVisible();
    await expect(page.locator('main').locator('h2:has-text("Not yet attempted")')).toBeVisible();
  });

  test('reflects activity after submissions', async ({ page }) => {
    // Submit on Learn, then use in-app client navigation (preserves the
    // session activity log; a full goto would reset it by design).
    await page.goto('/');
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');
    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Not quite', { timeout: 60000 });

    await page.locator('nav[aria-label="Primary"] a[href="/progress"]').click();
    await expect(page.locator('main').locator('h1')).toContainText('This session so far');
    await expect(page.locator('main').getByTestId('stat-attempted')).toContainText('1 of 8');
    await expect(page.locator('main').locator('text=Recent activity')).toBeVisible();
  });
});

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('main').locator('h1')).toContainText('Appearance and workspace', { timeout: 30000 });
  });

  test('loads Settings page', async ({ page }) => {
    await expect(page.locator('main').locator('h1')).toContainText('Appearance and workspace');
  });

  test('switches theme', async ({ page }) => {
    // Exact test IDs (the Light option description contains the word "dark",
    // so a text selector would match the wrong button).
    await expect(page.locator('main').getByTestId('theme-dark')).toBeVisible();
    await expect(page.locator('main').getByTestId('theme-light')).toBeVisible();
    await expect(page.locator('main').getByTestId('theme-system')).toBeVisible();

    await page.locator('main').getByTestId('theme-dark').click();
    // Real DOM condition: <html data-theme> painted by the theme engine.
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'learning-dark', null, { timeout: 30000 });

    await page.locator('main').getByTestId('theme-light').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'learning-light', null, { timeout: 30000 });
  });

  test('does not show backend diagnostics to learners', async ({ page }) => {
    await expect(page.locator('main')).not.toContainText('Diagnostics');
    await expect(page.locator('main').getByRole('heading', { name: 'API status' })).toHaveCount(0);
  });
});

test.describe('Responsive layouts', () => {
  for (const [name, width] of [['desktop 1440px', 1440], ['desktop 1280px', 1280], ['desktop 720px', 720], ['mobile 390px', 390]] as const) {
    test(`${name} - no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

test.describe('Workspace composition', () => {
  test('workspace is content-height; action and feedback continue below it in the SQL column', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });
    // Idle renders no tutor block by design; the workspace is schema + editor + action.
    await expect(page.locator('main').getByTestId('tutor-panel')).toHaveCount(0);

    const main = page.locator('main');
    const workspace = await main.getByRole('region', { name: 'Workspace' }).boundingBox();
    const schema = await main.getByTestId('schema-panel').boundingBox();
    const editor = await main.getByTestId('sql-editor').boundingBox();
    const submit = await main.getByTestId('submit-sql').boundingBox();
    expect(workspace).toBeTruthy();
    expect(schema).toBeTruthy();
    expect(editor).toBeTruthy();
    expect(submit).toBeTruthy();

    // Schema is the supporting left column; the SQL column starts to its right.
    expect(schema!.x + schema!.width).toBeLessThanOrEqual(editor!.x);

    // The action starts naturally after the workspace, in the query column.
    expect(submit!.y).toBeGreaterThanOrEqual(workspace!.y + workspace!.height);

    // Feedback appears only after a submission and remains aligned to the
    // SQL column, below the action.
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');
    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Not quite', { timeout: 60000 });
    const tutor = await main.getByTestId('tutor-panel').boundingBox();
    expect(tutor).toBeTruthy();
    expect(tutor!.x).toBeGreaterThanOrEqual(editor!.x);
    expect(tutor!.y).toBeGreaterThanOrEqual(submit!.y + submit!.height);
    // Same left edge as the action row: both align to the query column.
    expect(Math.abs(tutor!.x - submit!.x)).toBeLessThanOrEqual(1);

    // The Reference + Query divider ends with the workspace, before action and feedback.
    const outsideWorkspace = await page.evaluate(() => {
      const workspace = document.querySelector('main section[aria-label="Workspace"]');
      const action = document.querySelector('main [data-testid="submit-sql"]');
      const feedback = document.querySelector('main [data-testid="tutor-panel"]');
      return !!workspace && !!action && !!feedback && !workspace.contains(action) && !workspace.contains(feedback);
    });
    expect(outsideWorkspace).toBe(true);
  });
});

test.describe('Themes', () => {
  test('Light theme renders correctly', async ({ page }) => {
    await page.goto('/?theme=light');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'learning-light', null, { timeout: 30000 });
  });

  test('Dark theme renders correctly', async ({ page }) => {
    await page.goto('/?theme=dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'learning-dark', null, { timeout: 30000 });
  });
});

test.describe('API failure handling', () => {
  test('shows friendly error when backend is down', async () => {
    test.skip();
  });

  test('tutor failure shows role=alert, keeps the status line silent, and Retry recovers', async ({ page }) => {
    await waitForLearnReady(page);
    // First turn fails with a gateway error; the retry succeeds. Deterministic
    // (no LLM) and exercises the real browser network stack.
    let turnCalls = 0;
    await page.route('**/api/tutor/turn', async (route) => {
      turnCalls += 1;
      if (turnCalls === 1) {
        await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad gateway' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Recovered.',
          history: [],
          attempt: 1,
          tool_result: {
            correct: true,
            reason: 'ok',
            reason_label: 'Match',
            row_diff: [0, 0],
            hint_level: 1,
            gave_up: false,
          },
        }),
      });
    });

    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');
    await page.locator('main').getByTestId('submit-sql').click();

    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('The tutor service returned an error');
    await expect(alert).not.toContainText('HTTP 502');
    // The alert owns the moment: no stale outcome, action available again.
    await expect(page.locator('main').getByTestId('submit-status')).toBeEmpty();
    await expect(page.locator('main').getByTestId('submit-sql')).toBeEnabled();

    await page.locator('main').getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Correct', { timeout: 15000 });
    await expect(page.locator('main').getByTestId('submit-status')).toContainText('Correct.');
    expect(turnCalls).toBe(2);
  });
});

test.describe('Refresh/session semantics', () => {
  test('refresh resets session state', async ({ page }) => {
    await waitForLearnReady(page);
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT * FROM customers;');

    // Refresh
    await page.reload();
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });
    await waitForMonacoReady(page);

    // Draft should be gone (session-only)
    await page.locator('main').getByTestId('qnav-Q1').click();
    await expect(page.locator('main').getByTestId('sql-editor')).not.toContainText('customers');
  });
});

test.describe('Security/Secrets', () => {
  test('no secrets in frontend bundle', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });

    const content = await page.content();
    expect(content).not.toContain('GROQ_API_KEY');
    expect(content).not.toContain('DATABASE_URL');
    expect(content).not.toContain('postgresql://');
    expect(content).not.toContain('gsk_');
  });

  test('reference SQL not in normal responses', async ({ page }) => {
    const responses: string[] = [];
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/') && !resp.url().includes('/api/tutor/turn')) {
        const text = await resp.text().catch(() => '');
        responses.push(text);
      }
    });

    await page.goto('/');
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });
    await page.locator('main').getByTestId('qnav-Q1').click();
    await waitForMonacoReady(page);

    // Real app condition: schema data loaded (details rendered). The browser
    // GET /api/schema completes before this attaches.
    await expect(page.locator('main').getByTestId('schema-tables')).toBeAttached();

    for (const resp of responses) {
      expect(resp).not.toContain('reference_sql');
      expect(resp).not.toContain('SELECT COUNT(*) FROM orders');
      expect(resp).not.toContain('SELECT * FROM customers');
    }
  });
});

test.describe('Accessibility', () => {
  test('keyboard navigation works for important controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });

    // Tab through header
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
  });

  test('focus visible on buttons', async ({ page }) => {
    await waitForLearnReady(page);
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 1;');

    // Monaco traps Tab for indentation (standard editor behavior). Ctrl+M
    // toggles "Tab moves focus" so keyboard users can exit to Submit/Give up.
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('ControlOrMeta+M');
    // Tab until Submit is focused (real keyboard order, bounded loop).
    let submitFocused = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if (await page.locator('main').getByTestId('submit-sql').evaluate((el) => el === document.activeElement)) {
        submitFocused = true;
        break;
      }
    }
    expect(submitFocused).toBe(true);

    // Next Tab reaches Give up (ActionBar order: Submit, Give up).
    await page.keyboard.press('Tab');
    await expect(page.locator('main').getByTestId('give-up')).toBeFocused();
  });
});
