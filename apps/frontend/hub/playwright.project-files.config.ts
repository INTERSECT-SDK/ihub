import { defineConfig, devices } from '@playwright/test'

const hubUrl = 'http://127.0.0.1:8080/hub'

export default defineConfig({
  testDir: './e2e/project-files',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: 'output/playwright/report',
      },
    ],
  ],
  outputDir: 'output/playwright/test-results',
  use: {
    baseURL: hubUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run dev',
    url: hubUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
