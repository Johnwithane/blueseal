#!/usr/bin/env node
// Bug triage helper for Claude Code (and any maintainer at a terminal).
//
// The in-app "Report a bug" button writes structured docs to bugReports/{id}
// (see src/firebase/interfaces.ts → BugReportDoc) with screenshots in Storage.
// The admin UI (/admin/bug-reports) is for a human; THIS script is so Claude
// Code can pull those reports — including downloading the actual screenshot
// images locally — read them, dig into the codebase for root cause, and triage.
//
// It talks to PROD Firestore via the Firebase Admin SDK using Application
// Default Credentials (ADC) — the same "operate on real Firestore" path used
// elsewhere. No emulator. firebase-admin lives in functions/node_modules, so we
// resolve it from there (the repo root has no firebase-admin).
//
// Usage:
//   node scripts/bug-triage.mjs list [status]      # default status: open ("all" for every status)
//   node scripts/bug-triage.mjs show <id>          # one report, full detail + screenshots
//   node scripts/bug-triage.mjs triage <id> <status> [notes...]   # WRITE-BACK (only after the human OKs)
//   node scripts/bug-triage.mjs issue <id> [--triage-file <md>] [--dry-run] [--force]
//                                                  # file the report as a GitHub issue
//
// `list`/`show` are read-only and download screenshots to:
//   c:\tmp\bug-triage\<id>\shot-N.<ext>   (+ a digest.md / report.md you can read)
// Valid statuses: open | triaged | in_progress | fixed | wontfix
//
// Prereqs: `gcloud auth application-default login` (already done on this box)
// against project blueseal-762af, and `npm ci` has run inside functions/.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_ID = "blueseal-762af";
const STORAGE_BUCKET = "blueseal-762af.firebasestorage.app";
const OUT_ROOT = "c:\\tmp\\bug-triage";
const VALID_STATUSES = ["open", "triaged", "in_progress", "fixed", "wontfix"];

// Resolve firebase-admin from functions/node_modules (not present at repo root).
const requireFromFunctions = createRequire(
  fileURLToPath(new URL("../functions/package.json", import.meta.url)),
);
let admin;
try {
  admin = requireFromFunctions("firebase-admin");
} catch {
  console.error(
    "✖ Could not load firebase-admin. Run `npm ci` (or `npm install`) inside functions/ first.",
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID,
  storageBucket: STORAGE_BUCKET,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

/** Firestore Timestamp | Date | undefined → ISO string (or em dash). */
function fmtTime(ts) {
  try {
    const d = typeof ts?.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : null;
    return d ? d.toISOString() : "—";
  } catch {
    return "—";
  }
}

/** Download a screenshot Storage path to destDir, return the local file path (or null). */
async function downloadShot(storagePath, destDir, index) {
  const ext = (storagePath.split(".").pop() || "bin").toLowerCase();
  const dest = path.join(destDir, `shot-${index + 1}.${ext}`);
  try {
    await bucket.file(storagePath).download({ destination: dest });
    return dest;
  } catch (e) {
    console.error(`  ! screenshot download failed for ${storagePath}: ${e.message}`);
    return null;
  }
}

/** Render one report (+ optional local screenshot paths) as a Markdown block. */
function renderReport(id, r, localShots) {
  const lines = [
    `## ${r.title || "(untitled)"}  \`${id}\``,
    "",
    `- **Severity:** ${r.severity ?? "—"}`,
    `- **Status:** ${r.status ?? "—"}${r.notes ? `  — _notes:_ ${r.notes}` : ""}`,
    `- **Area:** ${r.area || "—"}`,
    `- **Reporter:** ${r.reporterName ?? "—"} (${r.activeRole ?? "—"}) · uid \`${r.reporterUid ?? "—"}\``,
    `- **Route:** \`${r.route ?? "—"}\``,
    `- **URL:** ${r.url || "—"}`,
    `- **App version:** ${r.appVersion || "—"}`,
    `- **Filed:** ${fmtTime(r.createdAt)} · updated ${fmtTime(r.updatedAt)}`,
    "",
    "### Steps to reproduce",
    (r.stepsToReproduce || "—").trim(),
    "",
    "### Expected",
    (r.expected || "—").trim(),
    "",
    "### Actual",
    (r.actual || "—").trim(),
    "",
    "### Device & environment",
    "```",
    (r.environment || "—").trim(),
    "```",
  ];
  if (localShots?.length) {
    lines.push("", "### Screenshots (downloaded locally — read these)");
    for (const p of localShots) lines.push(`- ${p}`);
  } else if (r.screenshotPaths?.length) {
    lines.push("", "### Screenshots", ...r.screenshotPaths.map((p) => `- (storage) ${p}`));
  }
  lines.push("");
  return lines.join("\n");
}

async function cmdList(statusArg) {
  const status = statusArg || "open";
  if (status !== "all" && !VALID_STATUSES.includes(status)) {
    console.error(`✖ Invalid status "${status}". Use one of: ${VALID_STATUSES.join(", ")}, all`);
    process.exit(1);
  }
  let q = db.collection("bugReports").orderBy("createdAt", "desc").limit(200);
  const snap = await q.get();
  let docs = snap.docs;
  if (status !== "all") docs = docs.filter((d) => d.data().status === status);

  if (docs.length === 0) {
    console.log(`No bug reports with status "${status}".`);
    return;
  }

  // Fresh output dir for this run so stale screenshots don't linger.
  await rm(OUT_ROOT, { recursive: true, force: true });
  await mkdir(OUT_ROOT, { recursive: true });

  const blocks = [];
  for (const d of docs) {
    const r = d.data();
    let localShots = [];
    if (r.screenshotPaths?.length) {
      const dir = path.join(OUT_ROOT, d.id);
      await mkdir(dir, { recursive: true });
      const results = await Promise.all(
        r.screenshotPaths.map((p, i) => downloadShot(p, dir, i)),
      );
      localShots = results.filter(Boolean);
    }
    blocks.push(renderReport(d.id, r, localShots));
  }

  const digest =
    `# Bug triage digest — status: ${status} — ${docs.length} report(s)\n\n` +
    `_Pulled from prod Firestore (${PROJECT_ID}). Screenshots downloaded under ${OUT_ROOT}._\n\n` +
    blocks.join("\n---\n\n");
  const digestPath = path.join(OUT_ROOT, "digest.md");
  await writeFile(digestPath, digest, "utf8");

  console.log(`✔ ${docs.length} report(s) [status: ${status}] → ${digestPath}`);
  console.log(`  Screenshots (if any) under ${OUT_ROOT}\\<id>\\`);
  console.log("");
  console.log(digest);
}

async function cmdShow(id) {
  if (!id) {
    console.error("✖ Usage: node scripts/bug-triage.mjs show <id>");
    process.exit(1);
  }
  const ref = db.collection("bugReports").doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    console.error(`✖ No bugReports/${id}`);
    process.exit(1);
  }
  const r = doc.data();
  let localShots = [];
  if (r.screenshotPaths?.length) {
    const dir = path.join(OUT_ROOT, id);
    await mkdir(dir, { recursive: true });
    const results = await Promise.all(r.screenshotPaths.map((p, i) => downloadShot(p, dir, i)));
    localShots = results.filter(Boolean);
  }
  const md = renderReport(id, r, localShots);
  const reportPath = path.join(OUT_ROOT, id, "report.md");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, md, "utf8");
  console.log(`✔ ${reportPath}`);
  console.log("");
  console.log(md);
}

async function cmdTriage(id, status, notesParts) {
  if (!id || !status) {
    console.error('✖ Usage: node scripts/bug-triage.mjs triage <id> <status> [notes...]');
    process.exit(1);
  }
  if (!VALID_STATUSES.includes(status)) {
    console.error(`✖ Invalid status "${status}". Use one of: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }
  const notes = (notesParts || []).join(" ");
  const ref = db.collection("bugReports").doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    console.error(`✖ No bugReports/${id}`);
    process.exit(1);
  }
  const update = {
    status,
    triagedBy: "claude-code",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (notes) update.notes = notes;
  await ref.update(update);
  console.log(`✔ bugReports/${id} → status="${status}"${notes ? `, notes set` : ""}`);
}

// --- GitHub issue flow ------------------------------------------------------
// `issue <id>` mirrors a bug report into a GitHub issue on origin's repo so
// triage lands where Johnny reviews. Privacy rule: bug docs carry reporter
// identity + a device dump + prod screenshots, so if the repo is PUBLIC the
// issue only gets title/severity/route/steps (+ triage notes) and points back
// at /admin/bug-reports for the rest; a private repo gets the full report with
// screenshots embedded via long-lived signed URLs.

const GITHUB_API = "https://api.github.com";

function repoSlug() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const m = url.match(/github\.com[/:]([^/]+\/.+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    /* fall through to the hardcoded default */
  }
  return "Johnwithane/blueseal";
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  // Same token `git push` uses (Git Credential Manager on this box). Never pop
  // an interactive login from a script.
  try {
    const out = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    });
    const m = out.match(/^password=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* no stored credential */
  }
  return null;
}

async function gh(token, method, apiPath, body) {
  const res = await fetch(`${GITHUB_API}${apiPath}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "blueseal-bug-triage",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: res.status, json, text };
}

function renderIssueBody(id, r, { repoIsPrivate, shotUrls, triageMd }) {
  const L = [
    `Bug report \`bugReports/${id}\` — severity **${r.severity ?? "—"}**` +
      `${r.area ? ` · area \`${r.area}\`` : ""} · filed ${fmtTime(r.createdAt)}`,
    "",
    `Route: \`${r.route ?? "—"}\`${repoIsPrivate && r.url ? ` — ${r.url}` : ""}`,
  ];
  if (repoIsPrivate) L.push(`Reporter: ${r.reporterName ?? "—"} (${r.activeRole ?? "—"})`);
  L.push("", "### Steps to reproduce", (r.stepsToReproduce || "—").trim(), "");
  L.push("### Expected", (r.expected || "—").trim(), "");
  L.push("### Actual", (r.actual || "—").trim(), "");
  if (repoIsPrivate) {
    L.push("### Device & environment", "```", (r.environment || "—").trim(), "```", "");
    if (shotUrls.length) {
      L.push("### Screenshots");
      shotUrls.forEach((u, i) => L.push(`![shot-${i + 1}](${u})`));
      L.push("");
    }
  } else {
    L.push(
      `_Repo is public, so reporter identity, device dump and screenshots stay out of the issue._`,
      `_Full report: \`/admin/bug-reports\` or \`npm run bugs show ${id}\`._`,
      "",
    );
  }
  if (triageMd) L.push("## Triage", "", triageMd.trim(), "");
  return L.join("\n");
}

async function cmdIssue(args) {
  const flags = { dryRun: false, force: false, triageFile: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--triage-file") flags.triageFile = args[++i];
    else positional.push(a);
  }
  const id = positional[0];
  if (!id) {
    console.error(
      "✖ Usage: node scripts/bug-triage.mjs issue <id> [--triage-file <md>] [--dry-run] [--force]",
    );
    process.exit(1);
  }

  const ref = db.collection("bugReports").doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    console.error(`✖ No bugReports/${id}`);
    process.exit(1);
  }
  const r = doc.data();
  if (r.githubIssueUrl && !flags.force) {
    console.log(`✔ Already filed: ${r.githubIssueUrl}  (use --force to file another)`);
    return;
  }

  const token = githubToken();
  if (!token) {
    console.error(
      "✖ No GitHub token. Set GITHUB_TOKEN (or GH_TOKEN), or sign into GitHub in git so `git credential fill` has one.",
    );
    process.exit(1);
  }
  const slug = repoSlug();
  const repo = await gh(token, "GET", `/repos/${slug}`);
  if (!repo.ok) {
    console.error(`✖ Could not read repo ${slug} (${repo.status}): ${repo.text.slice(0, 200)}`);
    process.exit(1);
  }
  const repoIsPrivate = !!repo.json?.private;

  const shotUrls = [];
  if (repoIsPrivate && r.screenshotPaths?.length) {
    for (const p of r.screenshotPaths) {
      try {
        const [u] = await bucket
          .file(p)
          .getSignedUrl({ action: "read", expires: Date.now() + 180 * 24 * 3600 * 1000 });
        shotUrls.push(u);
      } catch (e) {
        console.error(`  ! could not sign ${p}: ${e.message}`);
      }
    }
  }

  const triageMd = flags.triageFile ? await readFile(flags.triageFile, "utf8") : "";
  const title = (r.title || "(untitled bug report)").trim();
  const body = renderIssueBody(id, r, { repoIsPrivate, shotUrls, triageMd });
  const labels = ["bug", `sev:${r.severity || "medium"}`];

  if (flags.dryRun) {
    console.log(`— DRY RUN — would file on ${slug} (${repoIsPrivate ? "private" : "public"}):`);
    console.log(`Title: ${title}`);
    console.log(`Labels: ${labels.join(", ")}`);
    console.log("");
    console.log(body);
    return;
  }

  let res = await gh(token, "POST", `/repos/${slug}/issues`, { title, body, labels });
  // Labels need push access; if that's what 422'd, file without them.
  if (!res.ok && res.status === 422) {
    res = await gh(token, "POST", `/repos/${slug}/issues`, { title, body });
  }
  if (!res.ok) {
    console.error(`✖ GitHub refused (${res.status}): ${res.text.slice(0, 300)}`);
    process.exit(1);
  }
  await ref.update({
    githubIssueNumber: res.json.number,
    githubIssueUrl: res.json.html_url,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✔ Filed ${slug}#${res.json.number} → ${res.json.html_url}`);
  if (!repoIsPrivate) {
    console.log(
      "  (public repo: reporter identity, env dump and screenshots omitted — they stay in /admin/bug-reports)",
    );
  }
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "list") await cmdList(rest[0]);
  else if (cmd === "show") await cmdShow(rest[0]);
  else if (cmd === "triage") await cmdTriage(rest[0], rest[1], rest.slice(2));
  else if (cmd === "issue") await cmdIssue(rest);
  else {
    console.error("Usage:");
    console.error("  node scripts/bug-triage.mjs list [status|all]   (default: open)");
    console.error("  node scripts/bug-triage.mjs show <id>");
    console.error("  node scripts/bug-triage.mjs triage <id> <status> [notes...]");
    console.error(
      "  node scripts/bug-triage.mjs issue <id> [--triage-file <md>] [--dry-run] [--force]",
    );
    process.exit(1);
  }
  // Close gRPC channels before exiting — a hard exit with them open trips a
  // libuv assertion on Windows (async.c) and reddens the exit code.
  try {
    await admin.app().delete();
  } catch {
    /* best effort */
  }
  process.exit(0);
} catch (e) {
  console.error(`✖ ${e?.stack || e?.message || e}`);
  process.exit(1);
}
