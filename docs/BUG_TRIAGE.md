# Bug triage with Claude Code

The in-app **Report a bug** button (qa/admin only) writes structured docs to
`bugReports/{id}` — title, severity, area, steps/expected/actual, a full
device/environment dump, route + URL, reporter, and screenshots in Storage
(`BugReportDoc` in `src/firebase/interfaces.ts`). Humans triage them at
`/admin/bug-reports`. This doc is the **Claude Code** path: pull those reports —
including the actual screenshot images — read them, find the root cause in the
codebase, and triage.

## Two ways to get a bug to a fix

1. **Copy button** (`/admin/bug-reports`) — each report has a **Copy** button
   that puts a Markdown block (text + device/env + screenshot links) on the
   clipboard. Paste it into a chat to fix. Best when you're not in a CC session
   (e.g. on mobile pasting into claude.ai). Screenshots come through as links —
   the clipboard can't carry image bytes alongside text.

2. **`scripts/bug-triage.mjs`** (this script) — for when you *are* in a CC
   session. Pulls reports from prod Firestore **and downloads the screenshots
   locally** so Claude can `Read` the images, not just a URL.

## Prereqs

- ADC: `gcloud auth application-default login` against `blueseal-762af` (already
  set up on Johnny's box). The script uses the Firebase Admin SDK over ADC — no
  emulator, this is **real prod data**.
- `firebase-admin` is resolved from `functions/node_modules`, so `functions/`
  must have had `npm ci`/`npm install`.

## Commands

```bash
npm run bugs list            # open reports (default), newest first
npm run bugs list all        # every status
npm run bugs list triaged    # open | triaged | in_progress | fixed | wontfix
npm run bugs show <id>       # one report, full detail
# write-back — only after Johnny OKs the triage:
npm run bugs triage <id> <status> "triage notes here"
# mirror a report into a GitHub issue (repo from `git remote origin`):
npm run bugs -- issue <id> [--triage-file <md>] [--dry-run] [--force]
```

`list`/`show` write a digest to `c:\tmp\blueseal-bug-triage\digest.md` (or
`…\<id>\report.md`) and download screenshots to
`c:\tmp\blueseal-bug-triage\<id>\shot-N.<ext>`.
The output dir is wiped at the start of each `list` run so stale shots don't pile up.
It's project-scoped deliberately: another repo's triage script on this machine
writes to (and clears) the generic `c:\tmp\bug-triage`, and a parallel session
once wiped a freshly-downloaded set of Blue Seal screenshots mid-triage.

## The triage loop (how Claude should use it)

1. `npm run bugs list` → read the digest.
2. For each report: `Read` the downloaded screenshot(s), then investigate the
   codebase (route, area, env give you the starting point) for the root cause.
3. Produce a write-up: root cause, likely files, suggested severity + status,
   and a fix plan. **Report first** — don't fix or write back yet.
4. Once Johnny OKs: `npm run bugs triage <id> <status> "<notes>"` writes
   `status`/`notes`/`updatedAt` back (it stamps `triagedBy: "claude-code"`),
   then implement the fix as its own feature commit per the normal loop.

The `triage` write-back mirrors the admin UI's `setBugReportStatus` — it only
touches `status`, `notes`, `triagedBy`, `updatedAt`, the same fields the
`bugReports` update rule allows.

## GitHub issues

`npm run bugs -- issue <id>` files the report as a GitHub issue so triage lands
where Johnny reviews (note the `--` so npm doesn't eat the flags):

- **Auth:** `GITHUB_TOKEN` / `GH_TOKEN` env if set, else the token `git push`
  already uses (Git Credential Manager via `git credential fill`). No setup on
  Johnny's box.
- **Privacy:** bug docs carry reporter identity, a device dump, and prod
  screenshots. If the repo is **public** (it currently is), the issue gets only
  title/severity/route/steps + your triage notes, and points back at
  `/admin/bug-reports` for the rest. A **private** repo gets the full report
  with screenshots embedded as ~180-day signed URLs.
- **Triage notes:** write your root-cause/fix-plan Markdown to a file and pass
  `--triage-file <path>` — it lands in the issue under a `## Triage` heading.
- **Idempotent:** the issue number/URL are written back to the bug doc
  (`githubIssueNumber`/`githubIssueUrl`), and a second `issue <id>` is a no-op
  unless you pass `--force`. `--dry-run` prints the payload without filing.

Filing an issue does NOT change the report's `status` — that's still the
`triage` command, still gated on Johnny's OK.
