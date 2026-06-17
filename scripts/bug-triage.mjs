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
//
// `list`/`show` are read-only and download screenshots to:
//   c:\tmp\bug-triage\<id>\shot-N.<ext>   (+ a digest.md / report.md you can read)
// Valid statuses: open | triaged | in_progress | fixed | wontfix
//
// Prereqs: `gcloud auth application-default login` (already done on this box)
// against project blueseal-762af, and `npm ci` has run inside functions/.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, rm } from "node:fs/promises";
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

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "list") await cmdList(rest[0]);
  else if (cmd === "show") await cmdShow(rest[0]);
  else if (cmd === "triage") await cmdTriage(rest[0], rest[1], rest.slice(2));
  else {
    console.error("Usage:");
    console.error("  node scripts/bug-triage.mjs list [status|all]   (default: open)");
    console.error("  node scripts/bug-triage.mjs show <id>");
    console.error("  node scripts/bug-triage.mjs triage <id> <status> [notes...]");
    process.exit(1);
  }
  process.exit(0);
} catch (e) {
  console.error(`✖ ${e?.stack || e?.message || e}`);
  process.exit(1);
}
