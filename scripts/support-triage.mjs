#!/usr/bin/env node
// Support-ticket triage helper for Claude Code (and any maintainer at a terminal).
//
// The Help Center contact form writes docs to supportTickets/{id}
// (see src/firebase/interfaces.ts → SupportTicketDoc). The admin UI
// (/admin/support) is for a human; THIS script is so Claude Code can pull the
// queue, read each ticket, investigate, and triage (set status + leave internal
// notes). Sibling of scripts/bug-triage.mjs — same ADC / prod-Firestore path,
// minus screenshots (support tickets have no attachments).
//
// Usage:
//   node scripts/support-triage.mjs list [status]                 # default: open ("all" for every status)
//   node scripts/support-triage.mjs show <id>                     # one ticket, full detail
//   node scripts/support-triage.mjs triage <id> <status> [notes...]  # WRITE-BACK (only after the human OKs)
//
// `list`/`show` are read-only and write a digest to:
//   c:\tmp\support-triage\digest.md  /  \<id>\ticket.md
// Valid statuses: open | in_progress | resolved | closed
//
// Prereqs: `gcloud auth application-default login` against project blueseal-762af,
// and `npm ci` has run inside functions/ (firebase-admin lives there).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const PROJECT_ID = "blueseal-762af";
const OUT_ROOT = "c:\\tmp\\support-triage";
const VALID_STATUSES = ["open", "in_progress", "resolved", "closed"];

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
});
const db = admin.firestore();

/** Firestore Timestamp | Date | undefined → ISO string (or em dash). */
function fmtTime(ts) {
  try {
    const d = typeof ts?.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : null;
    return d ? d.toISOString() : "—";
  } catch {
    return "—";
  }
}

/** Render one ticket as a Markdown block (+ any replies already sent). */
function renderTicket(id, t, replies) {
  const lines = [
    `## ${t.topic || "(no topic)"}  \`${id}\``,
    "",
    `- **From:** ${t.name ?? "—"} <${t.email ?? "—"}> · uid \`${t.userId ?? "—"}\``,
    `- **Status:** ${t.status ?? "—"}${t.handledBy ? `  (handled by ${t.handledBy})` : ""}`,
    `- **Filed:** ${fmtTime(t.createdAt)} · updated ${fmtTime(t.updatedAt)}`,
    t.internalNotes ? `- **Internal notes:** ${t.internalNotes}` : null,
    "",
    "### Message",
    (t.message || "—").trim(),
  ].filter((l) => l !== null);
  if (replies?.length) {
    lines.push("", "### Replies already sent");
    for (const r of replies) {
      lines.push(`- _${fmtTime(r.sentAt)} (${r.mode})_ — ${(r.body || "").trim()}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function loadReplies(id) {
  try {
    const snap = await db
      .collection(`supportTickets/${id}/replies`)
      .orderBy("sentAt", "asc")
      .get();
    return snap.docs.map((d) => d.data());
  } catch {
    return [];
  }
}

async function cmdList(statusArg) {
  const status = statusArg || "open";
  if (status !== "all" && !VALID_STATUSES.includes(status)) {
    console.error(`✖ Invalid status "${status}". Use one of: ${VALID_STATUSES.join(", ")}, all`);
    process.exit(1);
  }
  const snap = await db.collection("supportTickets").orderBy("createdAt", "desc").limit(200).get();
  let docs = snap.docs;
  if (status !== "all") docs = docs.filter((d) => d.data().status === status);

  if (docs.length === 0) {
    console.log(`No support tickets with status "${status}".`);
    return;
  }

  await rm(OUT_ROOT, { recursive: true, force: true });
  await mkdir(OUT_ROOT, { recursive: true });

  const blocks = [];
  for (const d of docs) {
    const replies = await loadReplies(d.id);
    blocks.push(renderTicket(d.id, d.data(), replies));
  }

  const digest =
    `# Support triage digest — status: ${status} — ${docs.length} ticket(s)\n\n` +
    `_Pulled from prod Firestore (${PROJECT_ID})._\n\n` +
    blocks.join("\n---\n\n");
  const digestPath = path.join(OUT_ROOT, "digest.md");
  await writeFile(digestPath, digest, "utf8");

  console.log(`✔ ${docs.length} ticket(s) [status: ${status}] → ${digestPath}`);
  console.log("");
  console.log(digest);
}

async function cmdShow(id) {
  if (!id) {
    console.error("✖ Usage: node scripts/support-triage.mjs show <id>");
    process.exit(1);
  }
  const doc = await db.collection("supportTickets").doc(id).get();
  if (!doc.exists) {
    console.error(`✖ No supportTickets/${id}`);
    process.exit(1);
  }
  const replies = await loadReplies(id);
  const md = renderTicket(id, doc.data(), replies);
  const reportPath = path.join(OUT_ROOT, id, "ticket.md");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, md, "utf8");
  console.log(`✔ ${reportPath}`);
  console.log("");
  console.log(md);
}

async function cmdTriage(id, status, notesParts) {
  if (!id || !status) {
    console.error("✖ Usage: node scripts/support-triage.mjs triage <id> <status> [notes...]");
    process.exit(1);
  }
  if (!VALID_STATUSES.includes(status)) {
    console.error(`✖ Invalid status "${status}". Use one of: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }
  const notes = (notesParts || []).join(" ");
  const ref = db.collection("supportTickets").doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    console.error(`✖ No supportTickets/${id}`);
    process.exit(1);
  }
  const update = {
    status,
    handledBy: "claude-code",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (notes) update.internalNotes = notes;
  await ref.update(update);
  console.log(`✔ supportTickets/${id} → status="${status}"${notes ? ", internalNotes set" : ""}`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "list") await cmdList(rest[0]);
  else if (cmd === "show") await cmdShow(rest[0]);
  else if (cmd === "triage") await cmdTriage(rest[0], rest[1], rest.slice(2));
  else {
    console.error("Usage:");
    console.error("  node scripts/support-triage.mjs list [status|all]   (default: open)");
    console.error("  node scripts/support-triage.mjs show <id>");
    console.error("  node scripts/support-triage.mjs triage <id> <status> [notes...]");
    process.exit(1);
  }
  process.exit(0);
} catch (e) {
  console.error(`✖ ${e?.stack || e?.message || e}`);
  process.exit(1);
}
