---
name: bugs
description: Triage the in-app bug reports — pull the queue, diagnose each report, write statuses back, mirror to GitHub issues, and fix what's fixable. Use whenever Johnny asks "how are the bugs", "check the bugs", "triage the bugs", or wants a bug report investigated or fixed.
---

# Bug triage workflow

The in-app **Report a bug** button writes structured docs to `bugReports/{id}`
(screenshots in Storage). Every new report is ALSO auto-filed as a GitHub issue
on `Johnwithane/blueseal` by the `onBugReportCreated` function, so the queue is
visible from anywhere. Two workflows, depending on where you're running:

## Which session am I in?

- **Local (this machine, has ADC + Firestore access):** use the script below —
  it's the source of truth and downloads screenshots.
- **Remote (claude.ai/code, no Firestore):** work the GitHub issues instead —
  `gh issue list --label bug --state open` (or the GitHub API). Everything you
  do there flows back automatically (see "Remote sessions" below).

## Local workflow

1. **Pull the queue:** `npm run bugs -- list open` (statuses: `open | triaged |
   in_progress | fixed | wontfix`, or `all`). It prints a digest and downloads
   screenshots to `c:\tmp\bug-triage\<id>\` — **Read the screenshots**, they
   usually carry the real context.
2. **Diagnose before touching anything.** Check `git log` / recent PRs first —
   reports are often already fixed by work that just shipped, or duplicates of
   an already-triaged report (compare notes on `list all`). Verify against prod
   state (ADC admin SDK reads) and the code, not against assumptions.
3. **Write the triage back:**
   `npm run bugs -- triage <id> <status> <notes...>` — always include the root
   cause or the reason in the notes. Conventions:
   - Already shipped → `fixed` (this queues the reporter's "your bug is fixed"
     notice via the daily digest — only flip it when the fix is actually LIVE,
     hosting included, not merely committed).
   - Real work needed → `triaged` + file the issue (step 4), then `in_progress`
     while a fix session owns it.
   - Duplicate / human task / working as designed → `triaged` with notes
     naming the original report or the HUMANTASKS entry.
4. **Mirror to GitHub when there's work to do:**
   `npm run bugs -- issue <id> --triage-file <analysis.md>` — new reports are
   auto-filed already; use this only for reports that predate the auto-filing
   or when you want the triage analysis appended. On the public repo the issue
   is auto-redacted (no reporter identity / env dump / screenshots).
5. **Fix loop:** normal feature discipline (CLAUDE.md): fix → gates →
   deploy-before-commit → commit with `Fixes #<issue>` so the push closes the
   issue. After the fix is live, flip the report to `fixed`.
6. **Tell Johnny** what was open, what you did, and what's blocked on him
   (HUMANTASKS items — e.g. Stripe platform profile, the BUGS_GITHUB_TOKEN
   PAT).

## Remote sessions (GitHub is the working surface)

- Triage by labeling/commenting the issue; put the root-cause analysis in an
  issue comment.
- Add label `in-progress` when a session starts a fix; **close the issue**
  (commit `Fixes #N`, or close manually) when the fix has shipped; label
  `wontfix` + close for won't-fix.
- `scheduledBugIssueSync` (every 6h) writes GitHub state back to Firestore:
  closed → `fixed` (reporter gets notified next 09:00 digest), closed+`wontfix`
  → `wontfix`, `in-progress` label → `in_progress`, reopened → `triaged`.
  Nothing else to do — do NOT try to reach Firestore from a remote session.
- Remember remote sessions can't deploy Firebase (no credentials): land the
  code on a branch/PR and note in the issue that functions/rules still need a
  local deploy before merge (CLAUDE.md deploy-before-commit rule).

## Notes

- Reporter notifications: flipping to `fixed` is user-visible (batched digest
  at 09:00 America/Vancouver). `wontfix` never notifies, by design.
- The auto-file + sync functions need the `BUGS_GITHUB_TOKEN` secret (a
  fine-grained PAT, Issues read/write). While it holds the placeholder value
  `UNSET` they log a warning and skip — see HUMANTASKS.md.
- The admin UI at `/admin/bug-reports` is the human view of the same
  collection; keep statuses truthful for it.
