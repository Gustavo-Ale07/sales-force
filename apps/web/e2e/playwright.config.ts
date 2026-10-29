import { defineConfig, devices } from "@playwright/test";
import { E2E_WEB_ORIGIN } from "./support/env";

/**
 * Web E2E (Chromium, pt-BR). The global setup starts and stops the whole throwaway stack (see README.md); the
 * tests share one database, so they run serially in file order and without retries: a flaky test must be fixed,
 * not retried.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env["CI"]),
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: E2E_WEB_ORIGIN,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
