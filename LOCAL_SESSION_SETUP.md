# Local Session Setup (VS Code + Playwright)

> How to run the build as a **local Claude Code session in VS Code** — where I have your actual local files and a **real browser** (via Playwright MCP) to drive and screenshot *our* app. Use this instead of the cloud session for the hands-on build. Keep it turnkey; ~10 minutes.

## Why local (vs this cloud session)
- **Cloud session** (this one): ephemeral container, scoped to the GitHub repo. Great for planning + pushing docs.
- **Local session:** your real files on disk + a real browser. I can run the emulators, **drive our app, screenshot every screen, and keep the Playwright QA gate green** as I build.

## One-time setup
1. **Install Claude Code** and the **VS Code extension** (or run `claude` in the VS Code terminal). Sign in.
2. **Get the repos on disk:**
   - the **new app repo** (created per `SETUP.md` Stage 1), and
   - optionally the **Blue Seal repo** (this one) alongside it, so I can copy patterns directly.
3. **Node 20+** installed (`node -v`).
4. **Add the Playwright MCP server** (Blue Seal has no project `.mcp.json`, so add it at user level — do this once):
   ```bash
   claude mcp add playwright -- npx @playwright/mcp@latest
   ```
   Then in a session confirm the browser tools exist (`mcp__playwright__browser_navigate`, `_snapshot`, `_take_screenshot`, `_click`, `_console_messages`, `_network_requests`). *(If the command has changed, see the Playwright MCP readme — the package is `@playwright/mcp`.)*
5. Install browsers once if prompted: `npx playwright install chromium`.

## Open the session
- Open the **new app repo folder** in VS Code → start Claude Code there. (Add the Blue Seal folder to the workspace too if you want me referencing it live.)

## Kickoff prompt (paste this)
> "Read `MASTER_TOUR_CLONE_PLAN.md`, `SETUP.md`, and `CLAUDE.md`. Build the phases in `§10` in order. **For each phase: build it, write/run its `e2e/happy-paths/NN-*.spec.ts` green against the emulators (§18), then drive our app in the browser via Playwright MCP and screenshot the key screens so I can see them.** Keep the Help Center, QA toolkit, and Terms/Privacy current every feature (§19). Commit and push after each working sub-step. Pause and list what you need from me before any step that needs my Firebase/Stripe/Google account. Keep `CLAUDE.md` unchanged except adding the Legal bullet to its 'After every change' checklist."

## The build loop this enables
- I write a phase → run the Firebase emulators + dev server → **drive our app in a real browser** → screenshot it for you → keep the phase's Playwright test green → commit.
- I only ever automate **our** app in the browser.

## Important: Master Tour capture stays manual
- Don't ask me to log a browser into **Master Tour** and crawl it — that's ToS-violating scraping regardless of who drives it.
- Instead: **you** stay logged into your own Master Tour account, screenshot the screens (fill in `MASTER_TOUR_AUDIT.md` as you go), and **paste those screenshots to me** — I analyze them and design our modern equivalent. That's the IP-safe, faster path.
