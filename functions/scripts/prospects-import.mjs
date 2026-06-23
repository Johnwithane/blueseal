#!/usr/bin/env node
// One-shot importer for the Okanagan public-business research set.
//
// Reads the raw JSON pulled from the public Okanagan business directory's
// Supabase API (name / trade / city / coordinates / phone / website / Google
// rating + review_count / photos — NO email, Google never exposes one) and
// writes each as a PRIVATE seeded prospect (isListed=false) straight to prod
// Firestore via the Admin SDK. Mirrors the bulkImportProspects field shape so
// the admin tool + claim flow work, plus extra google* fields for sorting.
//
// Private by design: a scraped business is NEVER shown publicly. It only goes
// live if the owner claims it. No email is set, so nothing can be emailed until
// an admin adds one + asserts it's conspicuously published (the CASL gate).
//
// AUTH: gcloud auth application-default login   (or GOOGLE_APPLICATION_CREDENTIALS)
// PROJECT: defaults to blueseal-762af; override with $env:GCLOUD_PROJECT.
//
// RUN FROM functions/:
//   node scripts/prospects-import.mjs                 # dry-run (prints plan)
//   node scripts/prospects-import.mjs --yes           # actually import
//   node scripts/prospects-import.mjs --limit 25 --yes
//   node scripts/prospects-import.mjs --file ../okanagan-raw.json

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, GeoPoint } from "firebase-admin/firestore";
import { geohashForLocation } from "geofire-common";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "blueseal-762af";

// Directory category slug -> Blue Seal canonical trade key (src/data/trades.ts).
// null = no good match -> skip those rows rather than mis-tag them.
const TRADE_MAP = {
  "general-contractors": "general_contractor",
  "carpenters-framing": "carpenter",
  "concrete-contractors": "concrete",
  "masonry-brick-stone": "mason",
  roofing: "roofer",
  "excavation-site-prep": "excavation",
  demolition: "demolition",
  "civil-construction-pipelayers": "excavation",
  "structural-steel-erectors": "ironworker",
  "scaffolding-shoring": "general_contractor",
  "marine-construction-dock-builders": "deck_builder",
  "waterproofing-foundation-repair": "waterproofing",
  electricians: "electrician",
  plumbers: "plumber",
  "hvac-contractors": "hvac",
  "septic-drainage": "septic",
  "irrigation-systems": "irrigation",
  "solar-panel-installers": "solar_installer",
  "fire-protection-sprinkler-systems": "sprinkler_fitter",
  "security-av-low-voltage": "security_systems",
  "elevator-escalator-installers": null,
  "drywall-specialists": "drywall",
  painters: "painter",
  "flooring-installers": "flooring",
  "tile-installers": "tiling",
  "cabinet-makers-millwork": "cabinetry",
  "insulation-contractors": "insulation",
  "log-home-timber-frame-builders": "carpenter",
  "stucco-plastering-eifs": "stucco",
  landscapers: "landscaper",
  "fencing-contractors": "fencing",
  "deck-builders": "deck_builder",
  "siding-contractors": "siding",
  "window-door-installers": "window_installer",
  "paving-asphalt": "hardscaping",
  "pool-spa-installers": "pool_spa",
  "gutters-eavestroughing": "gutters",
  "snow-removal": "snow_removal",
  "welding-metal-fabrication": "welder",
  "glass-glaziers": "glazier",
  "garage-door-services": "garage_door",
  "sheet-metal-fabrication": "sheet_metal",
  "asbestos-hazmat-abatement": "demolition",
  "junk-removal": "junk_removal",
  restoration: "general_contractor",
  "handyman-services": "handyman",
};

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const prospectIdOf = (externalKey) => `p_${sha256(externalKey.trim().toLowerCase()).slice(0, 24)}`;
const avatarFor = (name) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`;

// Prefer a real Google business photo (lh3) over a street-view thumbnail of the
// address (streetviewpixels) — a street view isn't a useful avatar.
function pickPhoto(photos) {
  if (!Array.isArray(photos)) return null;
  const real = photos.find((p) => typeof p === "string" && p.includes("googleusercontent"));
  return real || null;
}

function db() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = keyPath ? cert(JSON.parse(readFileSync(keyPath, "utf8"))) : applicationDefault();
  initializeApp({ credential, projectId: PROJECT_ID });
  return getFirestore();
}

function buildRow(b, cityName) {
  const trade = TRADE_MAP[b.category_id];
  if (!trade) return { skip: "unmapped-trade" };
  if (!b.name || !b.coordinates || typeof b.coordinates.lat !== "number") return { skip: "no-name-or-coords" };

  const { lat, lng } = b.coordinates;
  const geohashPublic = geohashForLocation([lat, lng]).slice(0, 6);
  const photo = pickPhoto(b.photos);
  const placeId = b.placeId || "";
  const sourceUrl = placeId
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.name)}&query_place_id=${placeId}`
    : null;

  const doc = {
    displayName: b.name,
    photoURL: photo || avatarFor(b.name),
    companyName: b.name,
    bio: (b.description || "").slice(0, 1000),
    trades: [trade],
    yearsExperience: {},
    pricingModel: "quote",
    hourlyRate: null,
    languages: ["English"],
    locationApprox: new GeoPoint(lat, lng),
    geohashPublic,
    serviceRadiusKm: 40,
    locationLabel: `${cityName}, BC`,
    website: b.website && b.website.trim() ? b.website.trim() : null,
    portfolioPhotos: [],
    companyLogoUrl: null,
    bannerUrl: null,
    status: "listed",
    isListed: false, // PRIVATE — never public until claimed
    emailHash: "", // no email harvested; admin adds one before any send
    source: "Google Business profile (Okanagan public listing)",
    sourceUrl,
    dataConsentBasis: "manual_public_lookup",
    emailConspicuouslyPublished: false,
    licenceNumber: null,
    importedBy: "scrape:okanagan-2026-06-22",
    importedAt: FieldValue.serverTimestamp(),
    lastOutreachAt: null,
    outreachCount: 0,
    firstRequestedAt: null,
    claimedByUid: null,
    claimedAt: null,
    // --- extra provenance / Google signal (schemaless; powers sort + display) ---
    googleRating: typeof b.rating === "number" ? b.rating : 0,
    googleReviewCount: typeof b.review_count === "number" ? b.review_count : 0,
    googlePlaceId: placeId || null,
    googleCid: b.cid || null,
    googleSpecialties: Array.isArray(b.specialties) ? b.specialties.slice(0, 12) : [],
    googleServiceAreas: Array.isArray(b.service_areas) ? b.service_areas : [],
    googlePhotos: Array.isArray(b.photos) ? b.photos.slice(0, 8) : [],
    googleReviews: Array.isArray(b.reviews) ? b.reviews.slice(0, 3) : [],
    googleAddress: b.address || null,
  };
  const contact = {
    prospectEmail: "",
    prospectPhone: b.phone && b.phone.trim() ? b.phone.trim() : null,
    website: doc.website,
  };
  return { id: prospectIdOf(b.id), doc, contact };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--yes");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) : Infinity;
  const fileIdx = args.indexOf("--file");
  const file = fileIdx >= 0 ? args[fileIdx + 1] : "../okanagan-raw.json";

  const raw = JSON.parse(readFileSync(file, "utf8"));
  const cityName = Object.fromEntries(raw.cities.map((c) => [c.id, c.name]));
  const store = db();

  // Light dedup vs existing prospects (the earlier 131 + any prior run) by id
  // AND by displayName|locationLabel so we don't double-list the same business.
  const existing = await store.collection("prospects").get();
  const existingIds = new Set(existing.docs.map((d) => d.id));
  const existingNameLoc = new Set(
    existing.docs.map((d) => `${(d.get("displayName") || "").toLowerCase()}|${d.get("locationLabel") || ""}`),
  );

  const stats = { total: raw.businesses.length, planned: 0, dupeId: 0, dupeNameLoc: 0, unmappedTrade: 0, noCoords: 0 };
  const toWrite = [];
  for (const b of raw.businesses) {
    if (toWrite.length >= limit) break;
    const r = buildRow(b, cityName[b.city_id] || b.city_id);
    if (r.skip === "unmapped-trade") { stats.unmappedTrade++; continue; }
    if (r.skip === "no-name-or-coords") { stats.noCoords++; continue; }
    if (existingIds.has(r.id)) { stats.dupeId++; continue; }
    const nl = `${r.doc.displayName.toLowerCase()}|${r.doc.locationLabel}`;
    if (existingNameLoc.has(nl)) { stats.dupeNameLoc++; continue; }
    existingIds.add(r.id);
    existingNameLoc.add(nl);
    stats.planned = toWrite.push(r);
  }

  // Breakdown by trade + with-website count, for the dry-run summary.
  const byTrade = {};
  let withWebsite = 0, withRating = 0;
  for (const r of toWrite) {
    byTrade[r.doc.trades[0]] = (byTrade[r.doc.trades[0]] || 0) + 1;
    if (r.doc.website) withWebsite++;
    if (r.doc.googleReviewCount > 0) withRating++;
  }

  console.log("=== Okanagan prospect import ===");
  console.log(`Source rows: ${stats.total}`);
  console.log(`Skipped — unmapped trade: ${stats.unmappedTrade}, no name/coords: ${stats.noCoords}`);
  console.log(`Skipped — already a prospect (id): ${stats.dupeId}, (name+town): ${stats.dupeNameLoc}`);
  console.log(`WOULD IMPORT: ${stats.planned} (private/unlisted)`);
  console.log(`  with website: ${withWebsite} | with Google reviews: ${withRating}`);
  console.log("By trade:", JSON.stringify(byTrade, null, 0));

  if (!apply) {
    console.log("\nDRY RUN — re-run with --yes to write these to prod Firestore (private).");
    process.exit(0);
  }

  let n = 0;
  for (let i = 0; i < toWrite.length; i += 200) {
    const batch = store.batch();
    for (const r of toWrite.slice(i, i + 200)) {
      const ref = store.doc(`prospects/${r.id}`);
      batch.set(ref, r.doc);
      batch.set(ref.collection("private").doc("contact"), r.contact);
      n++;
    }
    await batch.commit();
    console.log(`  committed ${Math.min(i + 200, toWrite.length)}/${toWrite.length}`);
  }
  console.log(`\n✔ Imported ${n} prospects (all isListed=false / private).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err?.message || err);
  process.exit(1);
});
