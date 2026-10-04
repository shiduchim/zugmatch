import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /(peermatch|zugmatch)-shots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { deviceScaleFactor: 2 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
