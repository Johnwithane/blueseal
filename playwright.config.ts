import { defineConfig, devices } from "@playwright/test";

// Real-browser smoke tests for the SEO/prerender work. They serve the built
// dist/ (run `npm run build` first) through scripts/serve-dist.mjs, which
// mirrors Firebase Hosting's prerender + 200.html fallback resolution.
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  // The happy-paths harness drives the DEPLOYED test-mode site with real auth
  // and owns its own config (e2e/happy-paths/playwright.happy.config.ts) — keep
  // it out of this local-dist SEO smoke run. Use `npm run test:e2e:happy`.
  testIgnore: ["**/happy-paths/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  // `list` for live CI logs; `html` writes playwright-report/ with embedded
  // attachments (the 375px search screenshot) for the uploaded artifact.
  reporter: [["list"], ["html", { open: "never" }]],
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
