import { doc, getDoc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { SiteVisitDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import type { ProposeSiteVisitInput } from "@/validation/schemas";

// The informal "site visit before quoting" agreement — one doc per job at
// jobs/{jobId}/siteVisit/current. The tradesperson proposes it instead of, or
// before, quoting; the client agrees with one tap (no signature). Writes are
// callable-only (admin SDK) so "agreed" can't be forged — both parties just
// subscribe + call the callables below.

const siteVisitRef = (jobId: string) =>
  doc(db, "jobs", jobId, "siteVisit", "current").withConverter(typedConverter<SiteVisitDoc>());

export function subscribeSiteVisit(
  jobId: string,
  cb: (visit: WithId<SiteVisitDoc> | null) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  return onSnapshot(
    siteVisitRef(jobId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => {
      console.warn(`[Firestore] jobs/${jobId}/siteVisit listener:`, err.code, err.message);
      onError?.(err);
    },
  );
}

// One-shot read — used by QuoteSheet to pre-fill an agreed visit fee into the
// quote composer.
export async function getSiteVisit(jobId: string): Promise<WithId<SiteVisitDoc> | null> {
  const snap = await getDoc(siteVisitRef(jobId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function proposeSiteVisit(input: ProposeSiteVisitInput): Promise<{ ok: true }> {
  const fn = httpsCallable<ProposeSiteVisitInput, { ok: true }>(functions, "proposeSiteVisit");
  const res = await fn(input);
  return res.data;
}

export async function respondSiteVisit(input: {
  jobId: string;
  accept: boolean;
  declinedReason?: string;
}): Promise<{ ok: true }> {
  const fn = httpsCallable<typeof input, { ok: true }>(functions, "respondSiteVisit");
  const res = await fn(input);
  return res.data;
}
