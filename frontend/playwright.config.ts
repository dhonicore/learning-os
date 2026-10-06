import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'chromium-720',
      use: { ...devices['Desktop Chrome'], viewport: { width: 720, height: 720 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['iPhone 12'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command: 'cd /home/dhon1/Documents/learning-os && uvicorn app_main:app --port 8000',
      url: 'http://127.0.0.1:8000/api/ready',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        NEXT_PUBLIC_API_ORIGIN: 'http://127.0.0.1:8000',
      },
    },
  ],
});