import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

// Client wrappers for the rep-scoped vetting callables. A sales rep reviews +
// decides on the applications they own; the server enforces ownership (referral
// or region) on every call.

export interface RepApplicationSummary {
  id: string;
  displayName: string;
  trades: string[];
  regionId: string | null;
  referredByRepId: string | null;
  submittedAtMs: number | null;
}

export interface RepCertification {
  id: string;
  trade: string;
  issuingBody: string;
  certNumber: string;
  status: string;
  expiresAtMs: number | null;
  documentUrl: string | null;
}

export interface RepApplicationDetail {
  tradie: {
    id: string;
    displayName: string;
    trades: string[];
    bio: string;
    pricingModel: string | null;
    hourlyRate: number | null;
    serviceRadiusKm: number | null;
    vettingStatus: string;
    vettingNotes: string;
    regionId: string | null;
    referredByRepId: string | null;
    submittedAtMs: number | null;
  };
  idVerification: {
    documentType: string | null;
    status: string;
    submittedAtMs: number | null;
    documentUrl: string | null;
  } | null;
  certifications: RepCertification[];
  // Insurance + WSIB trust docs (read-only for reps). Null when not submitted.
  insurance: {
    insurer: string;
    policyNumber: string;
    coverageAmount: number;
    expiresAtMs: number | null;
    status: string;
    rejectionReason: string | null;
    blueSealAdditionalInsured: boolean | null;
    additionalInsuredConfirmedAtMs: number | null;
    liabilityReleaseSignedAtMs: number | null;
    documentUrl: string | null;
    releaseSignatureUrl: string | null;
  } | null;
  wsib: {
    province: string;
    clearanceNumber: string;
    expiresAtMs: number | null;
    status: string;
    rejectionReason: string | null;
    documentUrl: string | null;
  } | null;
}

/** The pending applications this rep owns (referral or region), newest gate. */
export async function listRepApplications(): Promise<RepApplicationSummary[]> {
  const fn = httpsCallable<Record<string, never>, { applications: RepApplicationSummary[] }>(
    functions,
    "listRepApplications",
  );
  const res = await fn({});
  return res.data.applications;
}

/** Full detail (certs + ID, with signed document URLs) for one owned application. */
export async function getApplicationDetails(tradieUid: string): Promise<RepApplicationDetail> {
  const fn = httpsCallable<{ tradieUid: string }, RepApplicationDetail>(
    functions,
    "getApplicationDetails",
  );
  const res = await fn({ tradieUid });
  return res.data;
}

// The three decision callables (now rep-scoped server-side). Thin wrappers so
// the rep views don't import the admin service.
export async function approveApplication(tradieUid: string): Promise<void> {
  const fn = httpsCallable<{ tradieUid: string }, { ok: boolean }>(functions, "approveApplication");
  await fn({ tradieUid });
}

export async function requestApplicationInfo(tradieUid: string, notes: string): Promise<void> {
  const fn = httpsCallable<{ tradieUid: string; notes: string }, { ok: boolean }>(
    functions,
    "requestApplicationInfo",
  );
  await fn({ tradieUid, notes });
}

export async function rejectApplication(tradieUid: string, reason: string): Promise<void> {
  const fn = httpsCallable<{ tradieUid: string; reason: string }, { ok: boolean }>(
    functions,
    "rejectApplication",
  );
  await fn({ tradieUid, reason });
}
