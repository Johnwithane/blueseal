// bugReports/{id} — the QA toolkit's manual bug log (the "human-filed" half of
// diagnostics; errorLogs is the automatic half). A qa/admin tester files a
// structured report from the in-app "Report a bug" button; admins triage it
// from /admin/bug-reports. Direct client writes under tight rules — no Cloud
// Function — mirroring supportTickets. Screenshots live under Storage at
// bugReports/{uid}/... and are read back via a path (owner + admin only).

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import { compressToWebp } from "@/utils/image";
import { resolveFileUrl, uploadFileNoUrl } from "@/firebase/services/storage";
import type { BugReportDoc, BugStatus, Role, WithId } from "@/firebase/interfaces";
import { bugReportSchema, type BugReportInput } from "@/validation/schemas";

const reportsCol = () =>
  collection(db, "bugReports").withConverter(typedConverter<BugReportDoc>());
const reportRef = (id: string) =>
  doc(db, "bugReports", id).withConverter(typedConverter<BugReportDoc>());

/** Context the "Report a bug" button captures automatically at file time. */
export interface BugReportContext {
  reporterName: string;
  activeRole: Role;
  url: string; // window.location.href
  route: string; // router fullPath or name
  environment: string; // preformatted device/env dump (capped at 4000 chars)
}

/**
 * File a bug report. Requires a signed-in qa/admin (the rules enforce
 * `reporterUid == uid` AND the qa/admin gate). Only the human-entered fields are
 * validated here; the reporter/route/status/timestamps are stamped on.
 */
export async function submitBugReport(
  input: BugReportInput,
  ctx: BugReportContext,
): Promise<string> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required to file a bug.");
  const data = bugReportSchema.parse(input);
  // Truncate every captured-context field to the cap the Firestore rules
  // enforce. The rules reject (not trim) anything over the limit, so a long page
  // URL or display name would silently fail the write — clamp here so a report
  // can never be blocked by auto-captured context.
  const ref = await addDoc(reportsCol(), {
    reporterUid: uid,
    reporterName: ctx.reporterName.slice(0, 120),
    url: ctx.url.slice(0, 500),
    route: ctx.route.slice(0, 200),
    activeRole: ctx.activeRole,
    environment: ctx.environment.slice(0, 4000),
    severity: data.severity,
    title: data.title,
    stepsToReproduce: data.stepsToReproduce,
    expected: data.expected,
    actual: data.actual,
    screenshotPaths: data.screenshotPaths,
    area: data.area,
    appVersion: (import.meta.env.VITE_APP_VERSION || "").slice(0, 60),
    status: "open",
    triagedBy: null,
    notes: "",
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
  });
  return ref.id;
}

/** The reporter's own bug reports, newest first (composite index reporterUid+createdAt). */
export async function listMyBugReports(uid: string): Promise<WithId<BugReportDoc>[]> {
  const snap = await getDocs(
    query(reportsCol(), where("reporterUid", "==", uid), orderBy("createdAt", "desc"), limit(200)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Admin triage queue. Newest first; status filtered client-side so no composite
 * index is needed (createdAt is a single-field auto index — same as supportTickets).
 */
export async function listAllBugReports(): Promise<WithId<BugReportDoc>[]> {
  const snap = await getDocs(query(reportsCol(), orderBy("createdAt", "desc"), limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Admin triage. The rules restrict the mutation to status/notes/triagedBy/updatedAt. */
export async function setBugReportStatus(
  id: string,
  status: BugStatus,
  notes: string,
): Promise<void> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required.");
  await updateDoc(reportRef(id), {
    status,
    notes,
    triagedBy: uid,
    updatedAt: serverTimestamp() as never,
  });
}

/**
 * Compress + upload a screenshot for a bug report and return its Storage path.
 * Stored under the reporter's own prefix; read back via resolveBugScreenshotUrl
 * (owner + admin can read). Path-only (no download URL) so it isn't world-readable.
 */
export async function uploadBugScreenshot(uid: string, file: File): Promise<string> {
  const compressed = await compressToWebp(file, { maxDimension: 1600, quality: 0.85 });
  const ext = compressed.type === "image/webp" ? "webp" : "jpg";
  const rand = crypto.randomUUID();
  const path = `bugReports/${uid}/${Date.now()}_${rand}.${ext}`;
  return uploadFileNoUrl(path, compressed);
}

/** Resolve a stored screenshot path to a viewable URL (owner + admin only). */
export function resolveBugScreenshotUrl(path: string): Promise<string> {
  return resolveFileUrl(path);
}
