import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env.CI;

// E2E database + bucket. The API picks these up from its environment
// (webServer env below overrides apps/api/.env). Never production values.
const e2eEnv = {
  ...process.env,
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    'postgresql://tmg:change_me_postgres@localhost:5432/chroniclex_e2e?schema=public',
  MINIO_BUCKET: process.env.E2E_MINIO_BUCKET ?? 'chroniclex-e2e',
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: ci ? 1 : 0,
  reporter: ci ? [['html', { open: 'never' }], ['list']] : [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ar-EG',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @chroniclex/api start',
      port: 3001,
      reuseExistingServer: true,
      timeout: 120_000,
      env: e2eEnv,
    },
    {
      command: 'pnpm --filter @chroniclex/web start',
      port: 3000,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { ...process.env, NEXT_PUBLIC_API_URL: 'http://localhost:3001' },
    },
  ],
});
