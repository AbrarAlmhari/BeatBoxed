import { defineConfig, devices } from '@playwright/test'

/**
 * Runs every spec twice: desktop Chrome and a touch phone. Several bugs here
 * have been touch-only (the play button that never appeared on phones), so a
 * desktop-only pass isn't evidence.
 */
export default defineConfig({
  testDir: './e2e',
  // These hit one shared Supabase project; parallel runs would fight over the
  // same follow rows.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx vite --port 5173',
    url: 'http://localhost:5173',
    // Always a fresh server: a server started before the last edit will push
    // an HMR reload mid-test and swallow the interaction under test.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
