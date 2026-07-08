import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";
import { maybeMarkVisible } from "./visibility";

interface CertData {
  status?: string;
  trade?: string;
  tradespersonId?: string;
  issuingBody?: string;
  certNumber?: string;
  expiresAt?: Timestamp | null;
}

// Mirror of the client's NO_CERT_SENTINEL (src/firebase/services/certifications.ts):
// a "no formal certification" self-declaration has issuingBody "Self-declared".
// We must NOT tell such a tradesperson their certification "was verified" —
// there is no certification, only an accepted declaration (P1-06).
const isSelfDeclared = (c: { issuingBody?: string; certNumber?: string }) =>
  c.issuingBody === "Self-declared" ||
  c.certNumber === "No formal certification — self-declared";

// Mirror of the client's isRedSealIssuer (src/utils/credentials.ts). The seed
// presets always set "Red Seal Program", but admins can type a free issuer, so
// match any casing/spacing of "red seal".
const isRedSeal = (issuingBody?: string) => /red\s*seal/i.test(issuingBody ?? "");

/**
 * When a cert flips to "approved", re-derive the tradie's PUBLIC credential
 * summary from ALL their approved certs:
 *   - `verifiedTrades`       — the distinct trade keys (drives the ✓-trade pills)
 *   - `verifiedCredentials`  — each approved cert's trade + issuing body + Red
 *                              Seal flag, denormalized so the public profile /
 *                              search / applicant cards can show *what* they're
 *                              certified in without read access to the admin+
 *                              owner-only certifications/{certId} docs.
 *
 * Re-deriving from a query (rather than an arrayUnion of the one cert) keeps the
 * write idempotent on re-approval and self-heals if a cert's issuer/expiry
 * changed between reviews. The query is single-field (tradespersonId) so it
 * needs no composite index; we filter to approved in memory.
 */
export const onCertApproved = onDocumentUpdated("certifications/{certId}", async (event) => {
  const before = event.data?.before.data() as CertData | undefined;
  const after = event.data?.after.data() as CertData | undefined;
  if (!after) return;
  if (before?.status === after.status) return;
  if (after.status !== "approved" || !after.trade || !after.tradespersonId) return;

  const tradespersonId = after.tradespersonId;

  const snap = await db
    .collection("certifications")
    .where("tradespersonId", "==", tradespersonId)
    .get();
  const approved = snap.docs
    .map((d) => d.data() as CertData)
    .filter((c) => c.status === "approved" && !!c.trade);

  const verifiedCredentials = approved
    .map((c) => ({
      trade: c.trade as string,
      issuingBody: c.issuingBody ?? "",
      redSeal: isRedSeal(c.issuingBody),
      expiresAt: c.expiresAt ?? null,
    }))
    // Red Seal first so the public credentials block leads with the prestige
    // credential.
    .sort((a, b) => Number(b.redSeal) - Number(a.redSeal));
  const verifiedTrades = [...new Set(approved.map((c) => c.trade as string))];

  await db.doc(`tradespeople/${tradespersonId}`).update({
    verifiedTrades,
    verifiedCredentials,
  });
  await maybeMarkVisible(tradespersonId);

  const selfDeclared = isSelfDeclared(after);
  await notify({
    userId: tradespersonId,
    type: "cert_approved",
    title: selfDeclared ? "Application approved" : "Certification approved",
    body: selfDeclared
      ? `Your ${after.trade} application was approved. Your profile is now showing on Blue Seal.`
      : `Your ${after.trade} certification was verified. It's now showing on your public profile.`,
    link: "/dashboard/tradie",
    recipientRole: "tradesperson",
  });
});
