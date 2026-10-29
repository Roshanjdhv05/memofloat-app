import { defineConfig } from '@playwright/test'

delete process.env.ELECTRON_RUN_AS_NODE

// Electron end-to-end tests drive the built app (out/) through Playwright's Electron support.
// They need a display: on Windows/macOS that is the normal desktop, on Linux use xvfb-run.
export default defineConfig({
  testDir: 'tests/integration',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off' }
})
