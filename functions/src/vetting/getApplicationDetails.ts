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

  const [tradieSnap, idSnap, certsSnap, insSnap, wsibSnap] = await Promise.all([
    db.doc(`tradespeople/${tradieUid}`).get(),
    db.doc(`idVerifications/${tradieUid}`).get(),
    db.collection("certifications").where("tradespersonId", "==", tradieUid).get(),
    db.doc(`insuranceVerifications/${tradieUid}`).get(),
    db.doc(`wsibVerifications/${tradieUid}`).get(),
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

  // Insurance + WSIB trust docs — read-only for reps (they can't read these via
  // rules), so a full vetter sees everything admin sees. Approve/reject of these
  // optional badges stays with admin; the rep's approveApplication gates go-live.
  const insData = insSnap.exists ? ((insSnap.data() ?? {}) as Record<string, unknown>) : null;
  const release = (insData?.liabilityRelease ?? null) as { signatureStoragePath?: string } | null;
  const insurance = insData
    ? {
        insurer: (insData.insurer as string) ?? "",
        policyNumber: (insData.policyNumber as string) ?? "",
        coverageAmount: (insData.coverageAmount as number) ?? 0,
        expiresAtMs: ms(insData.expiresAt),
        status: (insData.status as string) ?? "pending",
        rejectionReason: (insData.rejectionReason as string | null) ?? null,
        blueSealAdditionalInsured: (insData.blueSealAdditionalInsured as boolean | undefined) ?? null,
        additionalInsuredConfirmedAtMs: ms(insData.additionalInsuredConfirmedAt),
        liabilityReleaseSignedAtMs: release ? ms((insData.liabilityRelease as Record<string, unknown>).signedAt) : null,
        documentUrl: await signFileRef(insData.fileUrl),
        releaseSignatureUrl: await signFileRef(release?.signatureStoragePath),
      }
    : null;

  const wsibData = wsibSnap.exists ? ((wsibSnap.data() ?? {}) as Record<string, unknown>) : null;
  const wsib = wsibData
    ? {
        province: (wsibData.province as string) ?? "",
        clearanceNumber: (wsibData.clearanceNumber as string) ?? "",
        expiresAtMs: ms(wsibData.expiresAt),
        status: (wsibData.status as string) ?? "pending",
        rejectionReason: (wsibData.rejectionReason as string | null) ?? null,
        documentUrl: await signFileRef(wsibData.fileUrl),
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
    insurance,
    wsib,
  };
});
