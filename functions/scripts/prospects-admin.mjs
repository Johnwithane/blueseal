#!/usr/bin/env node
// One-shot admin tooling for the seeded-prospect cleanup + audit.
//
// Runs against PROD Firestore via firebase-admin. NOT a Cloud Function — a local
// script you run by hand. It exists because the seeded prospects were imported
// inline (bulkImportProspects takes rows in the request, no file on disk), so the
// only copy of the data is in Firestore and we need to pull it down to audit it.
//
// AUTH (one of):
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
//   — or —  gcloud auth application-default login   (then leave the var unset)
//
// PROJECT: defaults to blueseal-762af; override with $env:GCLOUD_PROJECT.
//
// RUN FROM the functions/ directory (so firebase-admin resolves):
//   cd functions
//   node scripts/prospects-admin.mjs export
//   node scripts/prospects-admin.mjs unlist-all          # dry-run (prints plan)
//   node scripts/prospects-admin.mjs unlist-all --yes    # actually unlist
//   node scripts/prospects-admin.mjs relist --file keep.json          # dry-run
//   node scripts/prospects-admin.mjs relist --file keep.json --yes    # apply
//
// Commands:
//   export      Read-only. Writes ./prospect-audit.json (+ .csv) with every
//               prospect and its private/contact subdoc, and prints a summary
//               incl. an OUTREACH CHECK (any status!=listed or outreachCount>0
//               would mean an email actually went out).
//   unlist-all  Sets isListed=false + unlistedForAudit=true + unlistedAt on every
//               prospect. Reversible: status is untouched and NO suppression
//               tombstone is written, so `relist` can put any of them back.
//               Writes the export snapshot first, then (with --yes) unlists.
//   relist      Sets isListed=true + unlistedForAudit=false for the prospect ids
//               in the --file JSON (an array of doc id strings).

import { readFileSync, writeFileSync } from "node:fs";
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "blueseal-762af";
const FREE_MAIL = /@(gmail|hotmail|outlook|yahoo|icloud|live|me|aol|proton|ymail|shaw|telus)\./i;
const INCORPORATED = /\b(ltd|ltd\.|limited|inc|inc\.|incorporated|corp|corp\.|corporation|holdings|enterprises)\b/i;

function db() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = keyPath ? cert(JSON.parse(readFileSync(keyPath, "utf8"))) : applicationDefault();
  initializeApp({ credential, projectId: PROJECT_ID });
  return getFirestore();
}

async function loadAll(store) {
  const snap = await store.collection("prospects").get();
  const rows = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    let contact = null;
    try {
      const c = await doc.ref.collection("private").doc("contact").get();
      contact = c.exists ? c.data() : null;
    } catch {
      contact = { _error: "could not read private/contact" };
    }
    rows.push({ id: doc.id, ...d, _contact: contact });
  }
  return rows;
}

// The fields the audit judges on, flattened so the CSV/JSON are easy to scan.
function auditRow(r) {
  const email = r._contact?.prospectEmail ?? "";
  return {
    id: r.id,
    displayName: r.displayName ?? "",
    companyName: r.companyName ?? "",
    trades: Array.isArray(r.trades) ? r.trades.join("|") : "",
    locationLabel: r.locationLabel ?? "",
    status: r.status ?? "",
    isListed: r.isListed === true,
    outreachCount: r.outreachCount ?? 0,
    dataConsentBasis: r.dataConsentBasis ?? "",
    emailConspicuouslyPublished: r.emailConspicuouslyPublished === true,
    licenceNumber: r.licenceNumber ?? "",
    source: r.source ?? "",
    sourceUrl: r.sourceUrl ?? "",
    website: r.website ?? r._contact?.website ?? "",
    email,
    phone: r._contact?.prospectPhone ?? "",
    // Heuristic signals the audit leans on (NOT decisions — flags for review):
    looksIncorporated: INCORPORATED.test(r.companyName ?? "") || INCORPORATED.test(r.displayName ?? ""),
    personalEmail: !!email && FREE_MAIL.test(email),
    hasLicence: !!r.licenceNumber,
    registryBasis: r.dataConsentBasis === "open_data" || r.dataConsentBasis === "public_registry",
  };
}

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function summarize(audit) {
  const by = (key) => audit.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
  const emailed = audit.filter((r) => r.status !== "listed" || r.outreachCount > 0);
  console.log(`\n=== Prospect audit summary (${audit.length} total) ===`);
  console.log("OUTREACH CHECK — rows that look emailed (status!=listed OR outreachCount>0):", emailed.length);
  if (emailed.length) console.log("  ⚠ ids:", emailed.map((r) => r.id).join(", "));
  console.log("Currently listed (public):", audit.filter((r) => r.isListed).length);
  console.log("By dataConsentBasis:", by("dataConsentBasis"));
  console.log("By status:", by("status"));
  console.log("Registry/open-data basis:", audit.filter((r) => r.registryBasis).length);
  console.log("Looks incorporated:", audit.filter((r) => r.looksIncorporated).length);
  console.log("Has licence number:", audit.filter((r) => r.hasLicence).length);
  console.log("Personal/free-mail email:", audit.filter((r) => r.personalEmail).length);
  console.log("emailConspicuouslyPublished=false:", audit.filter((r) => !r.emailConspicuouslyPublished).length);
}

async function cmdExport(store) {
  const rows = await loadAll(store);
  const audit = rows.map(auditRow);
  writeFileSync("prospect-audit.json", JSON.stringify(rows, null, 2));
  writeFileSync("prospect-audit.csv", toCsv(audit));
  summarize(audit);
  console.log("\nWrote prospect-audit.json (full docs) + prospect-audit.csv (audit columns).");
  return rows;
}

async function cmdUnlistAll(store, apply) {
  await cmdExport(store); // always snapshot first
  const snap = await store.collection("prospects").where("isListed", "==", true).get();
  console.log(`\nunlist-all: ${snap.size} prospect(s) currently listed.`);
  if (!apply) {
    console.log("DRY RUN — re-run with --yes to set isListed=false on all of them.");
    return;
  }
  let n = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = store.batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.update(doc.ref, {
        isListed: false,
        unlistedForAudit: true,
        unlistedAt: FieldValue.serverTimestamp(),
      });
      n++;
    }
    await batch.commit();
  }
  console.log(`✔ Unlisted ${n} prospect(s). Reversible via: relist --file keep.json`);
}

async function cmdRelist(store, file, apply) {
  if (!file) throw new Error("relist needs --file <keep.json> (a JSON array of prospect ids).");
  const ids = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(ids)) throw new Error("keep file must be a JSON array of id strings.");
  console.log(`relist: ${ids.length} id(s) from ${file}.`);
  if (!apply) {
    console.log("DRY RUN — re-run with --yes to set isListed=true on these.");
    console.log(ids.join(", "));
    return;
  }
  let n = 0;
  for (let i = 0; i < ids.length; i += 400) {
    const batch = store.batch();
    for (const id of ids.slice(i, i + 400)) {
      batch.update(store.doc(`prospects/${id}`), { isListed: true, unlistedForAudit: false });
      n++;
    }
    await batch.commit();
  }
  console.log(`✔ Re-listed ${n} prospect(s).`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--yes");
  const fileIdx = rest.indexOf("--file");
  const file = fileIdx >= 0 ? rest[fileIdx + 1] : null;
  const store = db();

  switch (cmd) {
    case "export": await cmdExport(store); break;
    case "unlist-all": await cmdUnlistAll(store, apply); break;
    case "relist": await cmdRelist(store, file, apply); break;
    default:
      console.log("Usage: node scripts/prospects-admin.mjs <export|unlist-all|relist> [--yes] [--file keep.json]");
      process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.message ?? err);
  process.exit(1);
});
