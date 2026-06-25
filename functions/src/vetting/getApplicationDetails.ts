import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db, storage } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireRepActive } from "../lib/salesRep";
import { assertRepOwnsTradie } from "../lib/vettingActor";

const Input = z.object({ tradieUid: z.string().min(1).max(128) });

/** Mint a short-lived signed read URL for a cert/ID file. Reps can't read these
 * via Storage rules (ID files are admin-only), so the server signs them. Accepts
 * a stored https URL as-is. */
async function signFileRef(fileRef: unknown): Promise<string | null> {
  if (typeof fileRef !== "string" || !fileRef) return null;
  if (fileRef.startsWith("http")) return fileRef;
  try {
    const [url] = await storage
      .bucket()
      .file(fileRef)
      .getSignedUrl({ action: "read", expires: Date.now() + 15 * 60 * 1000 });
    return url;
  } catch {
    return null;
  }
}

function ms(v: unknown): number | null {
  return v && typeof (v as { toMillis?: () => number }).toMillis === "function"
    ? (v as { toMillis: () => number }).toMillis()
    : null;
}

/**
 * A rep's owned application with its certifications + ID, ready to render. Reps
 * can't read pending tradesperson / cert / ID docs or their files via Firestore
 * + Storage rules (admin/owner only), so this Admin-SDK call gates on ownership
 * and returns a lean, JSON-safe shape with signed document URLs.
 */
export const getApplicationDetails = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "sales");
  await requireRepActive(uid);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { tradieUid } = parsed.data;
  await assertRepOwnsTradie(uid, tradieUid);

  const [tradieSnap, idSnap, certsSnap] = await Promise.all([
    db.doc(`tradespeople/${tradieUid}`).get(),
    db.doc(`idVerifications/${tradieUid}`).get(),
    db.collection("certifications").where("tradespersonId", "==", tradieUid).get(),
  ]);
  if (!tradieSnap.exists) throw new HttpsError("not-found", "Tradesperson not found.");
  const t = (tradieSnap.data() ?? {}) as Record<string, unknown>;

  const certifications = await Promise.all(
    certsSnap.docs.map(async (d) => {
      const c = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        trade: (c.trade as string) ?? "",
        issuingBody: (c.issuingBody as string) ?? "",
        certNumber: (c.certNumber as string) ?? "",
        status: (c.status as string) ?? "pending",
        expiresAtMs: ms(c.expiresAt),
        documentUrl: await signFileRef(c.fileUrl),
      };
    }),
  );

  const idData = idSnap.exists ? ((idSnap.data() ?? {}) as Record<string, unknown>) : null;
  const idVerification = idData
    ? {
        documentType: (idData.documentType as string) ?? null,
        status: (idData.status as string) ?? "pending",
        submittedAtMs: ms(idData.submittedAt),
        documentUrl: await signFileRef(idData.fileUrl),
      }
    : null;

  return {
    tradie: {
      id: tradieUid,
      displayName: (t.displayName as string) ?? "",
      trades: (t.trades as string[]) ?? [],
      bio: (t.bio as string) ?? "",
      pricingModel: (t.pricingModel as string) ?? null,
      hourlyRate: (t.hourlyRate as number | null) ?? null,
      serviceRadiusKm: (t.serviceRadiusKm as number | null) ?? null,
      vettingStatus: (t.vettingStatus as string) ?? "pending",
      vettingNotes: (t.vettingNotes as string) ?? "",
      regionId: (t.regionId as string | null) ?? null,
      referredByRepId: (t.referredByRepId as string | null) ?? null,
      submittedAtMs: ms(t.submittedAt),
    },
    idVerification,
    certifications,
  };
});
