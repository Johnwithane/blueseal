#!/usr/bin/env node
// Fix the imagery on scrape-imported prospects.
//
// Google business photos come in two URL shapes:
//   - /p/AF1Qip...      -> stable Google Place photos (load fine, keep)
//   - /gps-cs-s/AHV...  -> ephemeral scraper-session URLs (already 403/dead)
//   - streetviewpixels  -> street view of the address (not "work"; drop)
// The first import + first backfill used gps-cs-s URLs, so galleries rendered
// broken. This pass rebuilds photoURL + portfolioPhotos from ONLY the stable
// /p/ photos, and sets photoURL to null (UI shows an initials avatar) when a
// listing has none — no dependency on an external avatar service.
//
// Only touches prospects imported by the scrape (importedBy starts "scrape:"),
// so real uploads + the original seed set are left alone.
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

// Stable Google Place photos only.
const stablePhotos = (googlePhotos) =>
  Array.isArray(googlePhotos)
    ? googlePhotos.filter((p) => typeof p === "string" && p.includes("googleusercontent") && p.includes("/p/"))
    : [];

async function main() {
  const apply = process.argv.includes("--yes");
  const store = db();
  const snap = await store.collection("prospects").get();

  let withHero = 0, withGallery = 0, cleared = 0;
  const ops = [];
  for (const d of snap.docs) {
    if (!String(d.get("importedBy") || "").startsWith("scrape:")) continue;
    const stable = stablePhotos(d.get("googlePhotos"));
    const photoURL = stable[0] ?? null; // null -> initials avatar in the UI
    const portfolioPhotos = stable.slice(1, 9); // hero excluded from the gallery
    if (photoURL) withHero++;
    if (portfolioPhotos.length) withGallery++;
    if (!photoURL) cleared++;
    ops.push({ ref: d.ref, update: { photoURL, portfolioPhotos } });
  }

  console.log(`Scrape-imported prospects: ${ops.length}`);
  console.log(`  real /p/ hero photo: ${withHero} | gallery (2+ photos): ${withGallery} | no photo -> initials: ${cleared}`);
  if (!apply) {
    console.log("\nDRY RUN — re-run with --yes to write.");
    process.exit(0);
  }

  for (let i = 0; i < ops.length; i += 400) {
    const batch = store.batch();
    for (const o of ops.slice(i, i + 400)) batch.update(o.ref, o.update);
    await batch.commit();
    console.log(`  committed ${Math.min(i + 400, ops.length)}/${ops.length}`);
  }
  console.log(`\n✔ Repaired imagery on ${ops.length} prospects (stable /p/ photos only).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err?.message || err);
  process.exit(1);
});
