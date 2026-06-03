import { defineConfig, devices } from "@playwright/test";

// Real-browser smoke tests for the SEO/prerender work. They serve the built
// dist/ (run `npm run build` first) through scripts/serve-dist.mjs, which
// mirrors Firebase Hosting's prerender + 200.html fallback resolution.
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `node scripts/serve-dist.mjs`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
