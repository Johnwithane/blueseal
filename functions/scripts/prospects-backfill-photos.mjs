#!/usr/bin/env node
// Backfill portfolioPhotos on seeded prospects from the real Google business
// photos captured at import (stored in the googlePhotos field). The profile
// preview (/p/:id) + the editor render portfolioPhotos, so this is what makes
// the scraped imagery actually show. Uses ONLY real business photos
// (lh3.googleusercontent) — street-view thumbnails of the address aren't "work".
//
// Never clobbers a prospect that already has portfolioPhotos (a real upload).
//
// AUTH: gcloud auth application-default login. RUN FROM functions/:
//   node scripts/prospects-backfill-photos.mjs          # dry-run
//   node scripts/prospects-backfill-photos.mjs --yes    # apply

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "blueseal-762af";

function db() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = keyPath ? cert(JSON.parse(readFileSync(keyPath, "utf8"))) : applicationDefault();
  initializeApp({ credential, projectId: PROJECT_ID });
  return getFirestore();
}

// Real business photos only, the hero photo de-duped out, capped at 8.
function galleryFrom(googlePhotos, photoURL) {
  if (!Array.isArray(googlePhotos)) return [];
  return googlePhotos
    .filter((p) => typeof p === "string" && p.includes("googleusercontent") && p !== photoURL)
    .slice(0, 8);
}

async function main() {
  const apply = process.argv.includes("--yes");
  const store = db();
  const snap = await store.collection("prospects").get();

  let planned = 0, skipHasPortfolio = 0, skipNoRealPhotos = 0;
  const ops = [];
  for (const d of snap.docs) {
    const pf = d.get("portfolioPhotos");
    if (Array.isArray(pf) && pf.length > 0) { skipHasPortfolio++; continue; }
    const gallery = galleryFrom(d.get("googlePhotos"), d.get("photoURL"));
    if (!gallery.length) { skipNoRealPhotos++; continue; }
    planned++;
    ops.push({ ref: d.ref, gallery });
  }

  console.log(`Prospects scanned: ${snap.size}`);
  console.log(`WOULD set portfolioPhotos on: ${planned}`);
  console.log(`Skipped — already has portfolio: ${skipHasPortfolio}, no real business photos: ${skipNoRealPhotos}`);
  if (!apply) {
    console.log("\nDRY RUN — re-run with --yes to write.");
    process.exit(0);
  }

  for (let i = 0; i < ops.length; i += 400) {
    const batch = store.batch();
    for (const o of ops.slice(i, i + 400)) batch.update(o.ref, { portfolioPhotos: o.gallery });
    await batch.commit();
    console.log(`  committed ${Math.min(i + 400, ops.length)}/${ops.length}`);
  }
  console.log(`\n✔ Backfilled portfolioPhotos on ${ops.length} prospects.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err?.message || err);
  process.exit(1);
});
