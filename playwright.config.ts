import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  outputDir: './tmp/test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: './tmp/playwright-report' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: !!process.env.CI,
      },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120 * 1000,
    env: {
      // Disable Auth0 login gate for browser tests
      NUXT_PUBLIC_TLV2_LOGIN_GATE: 'false',
      NUXT_PUBLIC_TLV2_REQUIRE_LOGIN: 'false',
      // Point at a local Transitland GraphQL server
      NUXT_TLV2_PROXY_BASE_DEFAULT: process.env.NUXT_TLV2_PROXY_BASE_DEFAULT || 'http://localhost:8080',
    },
  },
})
