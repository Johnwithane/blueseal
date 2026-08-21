// GitHub Issues bridge for bug reports — the piece that makes bug triage work
// from a REMOTE session (claude.ai/code, another machine) with no Firestore
// credentials.
//
// Two directions:
//
//   onBugReportCreated  — every new bugReports/{id} doc is auto-filed as a
//                         GitHub issue on the repo, so a remote session can
//                         see and triage the full queue with nothing but repo
//                         access. Mirrors scripts/bug-triage.mjs `issue`,
//                         including its privacy rule: on a PUBLIC repo the
//                         issue carries only title/severity/route/steps and
//                         points back at /admin/bug-reports for reporter
//                         identity, device dump and screenshots.
//
//   scheduledBugIssueSync — reconciles GitHub state back into Firestore so
//                         work done remotely lands in the product: closing an
//                         issue marks the report fixed (label `wontfix` →
//                         wontfix), which is what queues the reporter's
//                         "your bug is fixed" notice (scheduledBugFixNotices,
//                         09:00 daily — this sweep runs ahead of it). Label
//                         `in-progress` on an open issue → in_progress;
//                         reopening a closed-out issue reverts to triaged.
//
// Auth: BUGS_GITHUB_TOKEN secret — a fine-grained PAT with Issues read/write
// on the repo (see HUMANTASKS.md). Both functions degrade gracefully (log +
// skip) while the secret holds the "UNSET" placeholder, so the deploy never
// blocks on the dashboard task.

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

export const BUGS_GITHUB_TOKEN = defineSecret("BUGS_GITHUB_TOKEN");

// No git remote to read here — the repo the issues live on, kept in step with
// scripts/bug-triage.mjs `repoSlug()`.
const REPO_SLUG = "Johnwithane/blueseal";
const GITHUB_API = "https://api.github.com";
const SCAN_LIMIT = 200;

function token(): string | null {
  const v = BUGS_GITHUB_TOKEN.value().trim();
  return v && v !== "UNSET" ? v : null;
}

async function gh(
  tok: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `token ${tok}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "blueseal-bug-issue-sync",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { ok: res.ok, status: res.status, json };
}

interface BugReportData {
  title?: string;
  severity?: string;
  area?: string;
  route?: string;
  url?: string;
  stepsToReproduce?: string;
  expected?: string;
  actual?: string;
  environment?: string;
  reporterName?: string;
  activeRole?: string;
  status?: string;
  githubIssueNumber?: number;
}

/** Issue body — full report on a private repo, redacted on a public one. */
function issueBody(id: string, r: BugReportData, repoIsPrivate: boolean): string {
  const L = [
    `Bug report \`bugReports/${id}\` — severity **${r.severity ?? "medium"}**` +
      `${r.area ? ` · area \`${r.area}\`` : ""}`,
    "",
    `Route: \`${r.route ?? "—"}\`${repoIsPrivate && r.url ? ` — ${r.url}` : ""}`,
  ];
  if (repoIsPrivate) L.push(`Reporter: ${r.reporterName ?? "—"} (${r.activeRole ?? "—"})`);
  L.push("", "### Steps to reproduce", (r.stepsToReproduce || "—").trim(), "");
  L.push("### Expected", (r.expected || "—").trim(), "");
  L.push("### Actual", (r.actual || "—").trim(), "");
  if (repoIsPrivate) {
    L.push("### Device & environment", "```", (r.environment || "—").trim(), "```", "");
  } else {
    L.push(
      "_Repo is public, so reporter identity, device dump and screenshots stay out of the issue._",
      `_Full report: \`/admin/bug-reports\` or \`npm run bugs show ${id}\`._`,
      "",
    );
  }
  L.push("---", "_Auto-filed from the in-app bug reporter. Triage workflow: `.claude/skills/bugs`._");
  return L.join("\n");
}

export const onBugReportCreated = onDocumentCreated(
  { document: "bugReports/{id}", secrets: [BUGS_GITHUB_TOKEN] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const id = event.params.id;
    const r = snap.data() as BugReportData;
    const ctx = { fn: "onBugReportCreated", reportId: id };

    const tok = token();
    if (!tok) {
      logger.warn("BUGS_GITHUB_TOKEN unset — bug report not mirrored to GitHub", ctx);
      return;
    }
    if (r.githubIssueNumber) return; // already filed (e.g. re-created doc)

    try {
      const repo = await gh(tok, "GET", `/repos/${REPO_SLUG}`);
      if (!repo.ok) {
        logger.error("could not read repo for privacy check", { ...ctx, status: repo.status });
        return;
      }
      const repoIsPrivate = !!(repo.json as { private?: boolean }).private;

      const title = (r.title || "(untitled bug report)").trim();
      const body = issueBody(id, r, repoIsPrivate);
      const labels = ["bug", `sev:${r.severity || "medium"}`];

      let res = await gh(tok, "POST", `/repos/${REPO_SLUG}/issues`, { title, body, labels });
      // Labels need push access; if that's what 422'd, file without them.
      if (!res.ok && res.status === 422) {
        res = await gh(tok, "POST", `/repos/${REPO_SLUG}/issues`, { title, body });
      }
      if (!res.ok) {
        logger.error("GitHub refused the issue", { ...ctx, status: res.status });
        return;
      }
      const issue = res.json as { number: number; html_url: string };
      await snap.ref.update({
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        updatedAt: FieldValue.serverTimestamp(),
      });
      logger.info("filed", { ...ctx, issue: issue.number });
    } catch (err) {
      // Best-effort mirror: the report itself is safe in Firestore either way.
      logger.error("failed to mirror bug report", { ...ctx, err });
    }
  },
);

export const scheduledBugIssueSync = onSchedule(
  { schedule: "every 6 hours", timeZone: "America/Vancouver", secrets: [BUGS_GITHUB_TOKEN] },
  async () => {
    const tok = token();
    if (!tok) {
      logger.warn("scheduledBugIssueSync: BUGS_GITHUB_TOKEN unset — skipping");
      return;
    }

    // Only reports that have a mirrored issue. `> 0` doubles as the
    // field-exists predicate (Firestore can't query for a missing field).
    const snap = await db
      .collection("bugReports")
      .where("githubIssueNumber", ">", 0)
      .limit(SCAN_LIMIT)
      .get();

    let updated = 0;
    for (const docSnap of snap.docs) {
      const r = docSnap.data() as BugReportData;
      const num = r.githubIssueNumber;
      if (!num) continue;

      const res = await gh(tok, "GET", `/repos/${REPO_SLUG}/issues/${num}`);
      if (!res.ok) {
        logger.warn("scheduledBugIssueSync: issue fetch failed", { reportId: docSnap.id, num });
        continue;
      }
      const issue = res.json as { state?: string; labels?: Array<{ name?: string }> };
      const labels = new Set((issue.labels ?? []).map((l) => l.name ?? ""));
      const status = r.status ?? "open";

      let next: string | null = null;
      if (issue.state === "closed") {
        // Closing the issue is the remote session's "shipped" signal. fixed is
        // what queues the reporter's notice; wontfix stays quiet by design.
        const target = labels.has("wontfix") ? "wontfix" : "fixed";
        if (status !== target) next = target;
      } else if (status === "fixed" || status === "wontfix") {
        // Reopened after being closed out — back into the triage queue. Clear
        // the digest stamp so a later re-fix re-announces to the reporter.
        next = "triaged";
      } else if (labels.has("in-progress") && (status === "open" || status === "triaged")) {
        next = "in_progress";
      }

      if (!next) continue;
      await docSnap.ref.update({
        status: next,
        triagedBy: "github-sync",
        updatedAt: FieldValue.serverTimestamp(),
        ...(next === "triaged" ? { fixNotifiedAt: FieldValue.delete() } : {}),
      });
      updated += 1;
    }
    logger.info("scheduledBugIssueSync: done", { scanned: snap.size, updated });
  },
);
