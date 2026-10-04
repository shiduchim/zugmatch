import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'python3 -m http.server 8787',
    url: 'http://localhost:8787/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
