# Happy-path E2E harness

Headless Playwright drivers that walk Blue Seal's core happy paths against the
**deployed test-mode site** (`https://blueseal-762af.web.app`) as two real
accounts, instrumented to surface bugs (console errors, failed callables/4xx-5xx,
`permission-denied`, dead-ends). It is a **bug-discovery harness**, not a hermetic
CI gate — it drives live prod-test data and the specs are written to keep going
and log findings rather than hard-fail on console noise. Findings land in
[`docs/qa-happy-paths-run.md`](../../docs/qa-happy-paths-run.md).

This is separate from the root `playwright.config.ts` (the SEO/prerender smokes
that serve `dist/` locally). The root config now ignores `**/happy-paths/**`, so
the two never cross-run.

## Setup

1. Two accounts must exist on the target project:
   - **client** — holds only the `client` role.
   - **tradesperson** — holds `tradesperson` + `admin` + `qa` (admin/qa let it
     self-provision and clear vetting via `/qa` mid-run).
2. Copy the env template and fill in the passwords:
   ```bash
   cp e2e/happy-paths/.env.local.example e2e/.env.local
   # edit e2e/.env.local — it is gitignored; never commit real creds
   ```
   `helpers/env.ts` loads `e2e/.env.local` (cwd = repo root) into `process.env`.
3. Browsers (one-time): `npx playwright install chromium`.

## Run

```bash
npm run test:e2e:happy          # the whole harness, headless, 1 worker, ordered
npm run test:e2e:happy:smoke    # just 00-smoke (auth + roles sanity)

# a single spec / target a different site / see the browser:
npx playwright test --config e2e/happy-paths/playwright.happy.config.ts 10-jobboard
QA_BASE_URL=http://localhost:5173 npm run test:e2e:happy
npx playwright test --config e2e/happy-paths/playwright.happy.config.ts --headed
```

HTML report + traces/video (on failure) are written to `e2e/.artifacts/`
(gitignored): `npx playwright show-report e2e/.artifacts/report`.

## Layout

| File | What it does |
| --- | --- |
| `playwright.happy.config.ts` | headless, `baseURL` = `QA_BASE_URL` (deployed default), 1 worker, retain trace/video on failure |
| `00-smoke.spec.ts` | both accounts sign in; each carries its expected roles (black-box via role-gated routes); provisions the tradie |
| `10-jobboard.spec.ts` | flagship two-sided leg: client posts → tradie sees it on the board → applies with an itemized quote; captures findings on both pages |
| `_explore.spec.ts` | dev tool, not a path test — `EXPLORE_ROUTE=/jobs/post EXPLORE_AS=client` dumps a route's buttons/fields/links so a driver can be built from ground truth |
| `helpers/env.ts` | minimal `.env.local` loader + `requireEnv` |
| `helpers/auth.ts` | `signIn`, `settle` (waits for `#bs-splash` detach), `holdsRole` (route-guard probe) |
| `helpers/provision.ts` | `/qa` self-provision / Pro toggle / reset for the tradie account |
| `helpers/jobs.ts` | `postJob`, generic `fillIntake`, `applyWithQuote`, `browseFindsJob`, `closeOpenPosts` (stay under the 5-open-posts cap) |
| `helpers/uploads.ts` | `setInputFiles` with the checked-in dummy ID/cert in `e2e/.artifacts/` |
| `helpers/walk.ts` | `attachCapture` (console/pageerror/4xx-5xx capture with a GA/CSP/Firestore-Listen noise filter), `findings`, `dumpPage` |

## Conventions

- **Selectors:** prefer text/role locators; PrimeVue quirks are documented inline
  (e.g. `.p-password input`, overlay-scoped option picking). When a flow changes,
  run `_explore.spec.ts` against the route to relearn selectors before editing.
- **`settle(page)`** after every nav — waits for the boot splash to detach
  (robust where `networkidle` never fires because Firestore sockets stay open).
- **Findings, not failures:** console/network errors are captured and logged, not
  thrown, so one path's noise doesn't abort the walk. Real bugs get triaged into
  the ledger.

## Safety / cleanup

Runs against the live **test-mode** project — Stripe is in test mode and there are
no real users, so residual data is low-risk. Tradesperson profiles created here
are `isQa`-tagged for the pre-launch sweep (see `HUMANTASKS.md`). The client's
open job posts are cancelled by `closeOpenPosts` to stay under the 5-open cap
across runs. Do not point `QA_BASE_URL` at a production project with real users.
