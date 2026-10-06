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
 * Type SQL as a real user would: focus the editor, optionally select-all to
 * replace, then type with a small per-key delay so Monaco registers every
 * keystroke. The delay is input pacing for editor reliability, not a sleep
 * wait — assertions below wait for real editor state.
 */
async function typeSql(page: Page, sql: string, clear = false) {
  await waitForMonacoReady(page);
  await page.locator('.monaco-editor').click();
  if (clear) {
    await page.keyboard.press('ControlOrMeta+A');
  }
  await page.keyboard.type(sql, { delay: 20 });
}

test.describe('Learn workspace — complete flow', () => {
  test.beforeEach(async ({ page }) => {
    await waitForLearnReady(page);
  });

  test('loads Learn page with question navigation', async ({ page }) => {
    await expect(page.locator('main').locator('h1')).toContainText('Practice the questions');
    await expect(page.locator('main').locator('p.eyebrow:has-text("Practice")').first()).toBeVisible();
    await expect(page.locator('main').locator('p.eyebrow:has-text("Held out")').first()).toBeVisible();
    await expect(page.locator('main').getByTestId('qnav-Q1')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('main').getByTestId('qnav-Q8')).toBeVisible();
  });

  test('navigates between questions', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await expect(page.locator('main').locator('h2.eyebrow:has-text("Question 1 of 8")')).toBeVisible();

    await page.locator('main').getByTestId('qnav-Q2').click();
    await expect(page.locator('main').locator('h2.eyebrow:has-text("Question 2 of 8")')).toBeVisible();

    await page.locator('main').getByTestId('qnav-Q3').click();
    await expect(page.locator('main').locator('h2.eyebrow:has-text("Question 3 of 8")')).toBeVisible();
  });

  test('opens schema panel', async ({ page }) => {
    await expect(page.locator('main').getByTestId('schema-panel')).toBeVisible();
    // Tables detail: table names are exact test IDs (avoids matching the
    // `orders.customer_id → customers.id` foreign-key text).
    await page.locator('main').getByTestId('schema-tables').locator('summary').click();
    await expect(page.locator('main').getByTestId('schema-table-customers')).toBeVisible();
    await expect(page.locator('main').getByTestId('schema-table-orders')).toBeVisible();
    // Foreign keys detail.
    await page.locator('main').getByTestId('schema-fks').locator('summary').click();
    await expect(page.locator('main').getByTestId('schema-fks')).toContainText('customer_id');
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
    await expect(page.locator('main').getByTestId('turn-meta')).toContainText('Attempt', { timeout: 60000 });
    await expect(page.locator('main').getByTestId('tutor-reply')).toBeVisible({ timeout: 60000 });
  });

  test('submits incorrect SQL and receives checker result + tutor response', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');

    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Incorrect', { timeout: 60000 });
    // Turn meta is the single source for hint level (EarlierAttempts uses a
    // different shape, so no strict-mode ambiguity).
    await expect(page.locator('main').getByTestId('turn-meta')).toContainText('hint level 1 of 4', { timeout: 60000 });
  });

  test('progressive hint levels on repeated incorrect submissions', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();

    const attempts = ['SELECT 13;', 'SELECT 14;', 'SELECT 15;', 'SELECT 16;'];
    for (let i = 0; i < attempts.length; i++) {
      await typeSql(page, attempts[i], i > 0);
      await page.locator('main').getByTestId('submit-sql').click();
      await expect(page.locator('main').getByTestId('turn-meta')).toContainText(`hint level ${i + 1} of 4`, { timeout: 60000 });
    }
  });

  test('Give Up discloses reference SQL', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await waitForMonacoReady(page);

    await page.locator('main').getByTestId('give-up').click();
    // Real disclosure conditions: tutor reply renders the reference SQL in a
    // code block, the gave-up note appears, and the button disables.
    await expect(page.locator('main').getByTestId('tutor-reply')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('main').getByTestId('tutor-reply').locator('code:has-text("SELECT")').first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('main').getByText('reference SQL is now disclosed')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('main').getByTestId('give-up')).toBeDisabled();
  });

  test('duplicate submission guard works', async ({ page }) => {
    await page.locator('main').getByTestId('qnav-Q1').click();
    await typeSql(page, 'SELECT 13;');
    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Incorrect', { timeout: 60000 });

    // Immediate duplicate (same qid + SQL + Submit within 1.5 s window).
    await page.locator('main').getByTestId('submit-sql').click();
    await expect(page.locator('main').getByTestId('duplicate-caption')).toContainText('Duplicate submission ignored');
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
    await expect(page.locator('main').locator('text=No submissions yet. Submit SQL')).toBeVisible();
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
    await expect(page.locator('main').getByTestId('tutor-status')).toContainText('Incorrect', { timeout: 60000 });

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
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest-dark', null, { timeout: 30000 });

    await page.locator('main').getByTestId('theme-light').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest-light', null, { timeout: 30000 });
  });

  test('shows backend diagnostics', async ({ page }) => {
    // Visible diagnostics content (the "Backend diagnostics" h2 is sr-only
    // by design; users see the Diagnostics section + live API status).
    await expect(page.locator('main').locator('text=Diagnostics').first()).toBeVisible();
    await expect(page.locator('main').getByRole('heading', { name: 'API status' })).toBeVisible();
    await expect(page.locator('[role="status"]').first()).toBeVisible();
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

test.describe('Themes', () => {
  test('Light theme renders correctly', async ({ page }) => {
    await page.goto('/?theme=light');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest-light', null, { timeout: 30000 });
  });

  test('Dark theme renders correctly', async ({ page }) => {
    await page.goto('/?theme=dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest-dark', null, { timeout: 30000 });
  });
});

test.describe('API failure handling', () => {
  test('shows friendly error when backend is down', async () => {
    test.skip();
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
    // toggles "Tab moves focus" so keyboard users can exit to Submit/Give Up.
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

    // Next Tab reaches Give Up (ActionBar order: Submit, Give Up).
    await page.keyboard.press('Tab');
    await expect(page.locator('main').getByTestId('give-up')).toBeFocused();
  });
});
