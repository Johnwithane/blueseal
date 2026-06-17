import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "./helpers/env";

// Happy-path QA drivers — run HEADLESS against the deployed TEST-MODE site (not
// the SEO smoke in ../). Separate config so it never serves dist/ locally.
loadEnv();

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1, // ordered, watchable logs; multi-actor specs coordinate contexts
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "../.artifacts/report" }]],
  outputDir: "../.artifacts/output",
  use: {
    baseURL: process.env.QA_BASE_URL || "https://blueseal-762af.web.app",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 25_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
