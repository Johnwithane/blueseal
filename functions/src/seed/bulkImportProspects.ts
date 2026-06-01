// Admin-only callable: import reviewed seeded-prospect rows into prospects/.
//
// Writes the public discovery doc prospects/{id} + the admin-only private
// contact subdoc prospects/{id}/private/contact. Seeded prospects are NOT
// members — they carry none of the trust fields (idVerified / verifiedTrades /
// insurance / wsib / ratings) and live in a separate collection from
// tradespeople/ so they can never satisfy the isVisible==vetted invariant.
//
// Idempotent: the doc id is derived deterministically from the row's
// externalKey, so re-importing the same row is skipped as a dupe. Every write
// is gated on the permanent prospectSuppression tombstones first, so anyone who
// unsubscribed/asked for takedown is never re-imported. Validates each row with
// the shared Zod schema and collects per-row errors instead of throwing on the
// first bad row. Supports a dryRun that reports what WOULD import.

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { geohashForLocation } from "geofire-common";
import { createHash, randomBytes } from "node:crypto";
import { logger } from "firebase-functions/v2";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { seededProspectRowSchema, type SeededProspectRow } from "./seededProspectSchema";

// One call = one reviewed batch. Bounds the work + keeps each WriteBatch
// (2 writes/row) well under the 500-op limit.
const MAX_ROWS = 200;
const READ_CHUNK = 100;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const emailHashOf = (email: string): string => sha256(email.trim().toLowerCase());
const prospectIdOf = (externalKey: string): string =>
  `p_${sha256(externalKey.trim().toLowerCase()).slice(0, 24)}`;

interface RowError {
  rowIndex: number;
  message: string;
}

interface ImportResult {
  received: number;
  imported: number; // for dryRun: the count that WOULD import
  dupeSkipped: number;
  suppressedSkipped: number;
  invalid: number;
  errors: RowError[];
  dryRun: boolean;
}

interface PlannedRow {
  id: string;
  emailHash: string;
  row: SeededProspectRow;
}

export const bulkImportProspects = onCall(
  CALLABLE_OPTS,
  async (req): Promise<ImportResult> => {
    const actor = requireAdmin(req);

    const data = req.data as { rows?: unknown; dryRun?: unknown } | undefined;
    const dryRun = data?.dryRun === true;
    if (!Array.isArray(data?.rows)) {
      throw new HttpsError("invalid-argument", "rows must be an array.");
    }
    const rawRows = data.rows as unknown[];
    if (rawRows.length === 0) {
      throw new HttpsError("invalid-argument", "No rows provided.");
    }
    if (rawRows.length > MAX_ROWS) {
      throw new HttpsError(
        "invalid-argument",
        `Too many rows (${rawRows.length}); max ${MAX_ROWS} per call.`,
      );
    }

    const received = rawRows.length;
    let imported = 0;
    let dupeSkipped = 0;
    let suppressedSkipped = 0;
    let invalid = 0;
    const errors: RowError[] = [];

    // Validate + plan each row (collect errors; never throw on the first).
    // Intra-batch dedup by derived id so a file with the same row twice writes
    // it once.
    const planned: PlannedRow[] = [];
    const seenIds = new Set<string>();
    for (let i = 0; i < rawRows.length; i++) {
      const parsed = seededProspectRowSchema.safeParse(rawRows[i]);
      if (!parsed.success) {
        invalid += 1;
        errors.push({
          rowIndex: i,
          message: parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(row)"}: ${issue.message}`)
            .join("; "),
        });
        continue;
      }
      const row = parsed.data;
      const id = prospectIdOf(row.externalKey);
      if (seenIds.has(id)) {
        dupeSkipped += 1;
        continue;
      }
      seenIds.add(id);
      planned.push({ id, emailHash: emailHashOf(row.publicEmail), row });
    }

    // Dedup against existing prospects + suppression tombstones, then write.
    for (let start = 0; start < planned.length; start += READ_CHUNK) {
      const chunk = planned.slice(start, start + READ_CHUNK);

      const checks = await Promise.all(
        chunk.map(async (p) => {
          const [existing, suppressed] = await Promise.all([
            db.doc(`prospects/${p.id}`).get(),
            db.doc(`prospectSuppression/${p.emailHash}`).get(),
          ]);
          return { exists: existing.exists, suppressed: suppressed.exists };
        }),
      );

      const batch = db.batch();
      let batchWrites = 0;

      chunk.forEach((p, idx) => {
        if (checks[idx].suppressed) {
          suppressedSkipped += 1;
          return;
        }
        if (checks[idx].exists) {
          dupeSkipped += 1;
          return;
        }
        imported += 1;
        if (dryRun) return; // count, don't write

        const { row } = p;
        const trades = [
          row.primaryTrade,
          ...row.secondaryTrades.filter((t) => t !== row.primaryTrade),
        ];
        const yearsExperience: Record<string, number> = {};
        if (row.yearsExperience != null) {
          yearsExperience[row.primaryTrade] = row.yearsExperience;
        }
        const geohashPublic = geohashForLocation([
          row.locationApprox.lat,
          row.locationApprox.lng,
        ]).slice(0, 6);

        const ref = db.doc(`prospects/${p.id}`);
        batch.set(ref, {
          displayName: row.displayName,
          companyName: row.businessName,
          bio: row.bio,
          trades,
          yearsExperience,
          pricingModel: row.pricingModel,
          hourlyRate: row.hourlyRate,
          languages: row.languages,
          locationApprox: new GeoPoint(
            row.locationApprox.lat,
            row.locationApprox.lng,
          ),
          geohashPublic,
          serviceRadiusKm: row.serviceRadiusKm,
          status: "listed",
          isListed: true,
          emailHash: p.emailHash,
          source: row.source,
          sourceUrl: row.sourceUrl,
          dataConsentBasis: row.dataBasis,
          emailConspicuouslyPublished: row.emailConspicuouslyPublished,
          licenceNumber: row.licenceNumber,
          importedBy: actor,
          importedAt: FieldValue.serverTimestamp(),
          unsubToken: randomBytes(24).toString("hex"),
          lastOutreachAt: null,
          outreachCount: 0,
          firstRequestedAt: null,
          claimedByUid: null,
          claimedAt: null,
        });
        batch.set(ref.collection("private").doc("contact"), {
          prospectEmail: row.publicEmail.trim().toLowerCase(),
          prospectPhone: row.publicPhone,
          website: row.website,
        });
        batchWrites += 2;
      });

      if (!dryRun && batchWrites > 0) await batch.commit();
    }

    await logAdminAction({
      actorUid: actor,
      action: "bulkImportProspects",
      targetType: "prospects",
      targetId: "*",
      metadata: { received, imported, dupeSkipped, suppressedSkipped, invalid, dryRun },
    });
    logger.info("bulkImportProspects: done", {
      actor,
      received,
      imported,
      dupeSkipped,
      suppressedSkipped,
      invalid,
      dryRun,
    });

    return { received, imported, dupeSkipped, suppressedSkipped, invalid, errors, dryRun };
  },
);
