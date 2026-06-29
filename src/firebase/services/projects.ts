// Projects service (Project Manager dispatch). Callable wrappers for the
// magic-link project-invite flow + live reads over the top-level `projects/{id}`
// collection (see ProjectDoc). The whole doc is server-managed — every WRITE goes
// through a callable; clients only READ (the PM their own, the client theirs).
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { ProjectDoc, WithId } from "@/firebase/interfaces";
import type { ProjectDraft } from "@/validation/projects";

const projectsCol = () =>
  collection(db, "projects").withConverter(typedConverter<ProjectDoc>());
const projectDocRef = (id: string) =>
  doc(db, "projects", id).withConverter(typedConverter<ProjectDoc>());

// ── Callables ──────────────────────────────────────────────────────────────

export interface CreateProjectResult {
  projectId: string;
  inviteLink: string;
  emailed: boolean;
}

/** PM creates a project + sends the client a magic-link invite. */
export async function createProject(draft: ProjectDraft): Promise<CreateProjectResult> {
  const fn = httpsCallable<ProjectDraft, CreateProjectResult>(functions, "createProject");
  const res = await fn(draft);
  return res.data;
}

export interface UpdateProjectInput {
  projectId: string;
  label: string;
  clientName: string;
  propertyId: string | null;
  unit: string | null;
  photoUrl: string | null;
  jobs: { trade: string; title: string; description: string }[];
}

/**
 * PM edits a project that the client hasn't accepted yet (label, client name,
 * photo, property, and the job list). Changing the client's email is a separate
 * flow (resendProjectInvite). Server rejects edits once the project is accepted.
 */
export async function updateProject(input: UpdateProjectInput): Promise<{ ok: true }> {
  const fn = httpsCallable<UpdateProjectInput, { ok: true }>(functions, "updateProject");
  const res = await fn(input);
  return res.data;
}

export interface AddProjectJobInput {
  trade: string;
  title: string;
  description: string;
}

/**
 * PM adds jobs to a project the client has ALREADY accepted. Each added job lands
 * as a "pendingClient" spec the client must approve per-job (respondToProjectJob)
 * before it dispatches. Use updateProject (not this) to edit the bundle pre-accept.
 */
export async function proposeProjectJobs(
  projectId: string,
  jobs: AddProjectJobInput[],
): Promise<{ ok: true; added: number; specIds: string[] }> {
  const fn = httpsCallable<
    { projectId: string; jobs: AddProjectJobInput[] },
    { ok: true; added: number; specIds: string[] }
  >(functions, "proposeProjectJobs");
  const res = await fn({ projectId, jobs });
  return res.data;
}

/**
 * Client approves or declines ONE job their PM added after they accepted the
 * project. Approving dispatches that job to the PM's preferred contractors for
 * quotes (the work address was captured at the original accept). Declining marks
 * it declined and notifies the PM.
 */
export async function respondToProjectJob(
  projectId: string,
  specId: string,
  response: "accept" | "decline",
): Promise<{ status: "accepted"; postId: string; unmatched: boolean } | { status: "declined" }> {
  const fn = httpsCallable<
    { projectId: string; specId: string; response: "accept" | "decline" },
    { status: "accepted"; postId: string; unmatched: boolean } | { status: "declined" }
  >(functions, "respondToProjectJob");
  const res = await fn({ projectId, specId, response });
  return res.data;
}

/** Copy-link path: emails a fresh magic sign-in link to the invite's stored address. */
export async function sendProjectInviteSignInLink(
  token: string,
  email: string,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ token: string; email: string }, { ok: true }>(
    functions,
    "sendProjectInviteSignInLink",
  );
  const res = await fn({ token, email });
  return res.data;
}

export interface ProjectInvitePreview {
  projectId: string;
  label: string;
  clientName: string;
  jobCount: number;
}

export type ClaimProjectInviteResult =
  | { status: "needs_verification" }
  | { status: "none"; invites: [] }
  | { status: "preview"; invites: ProjectInvitePreview[] }
  | { status: "claimed"; claimed: number; projectIds: string[] };

/** Magic-link-signed-in client claims every project invite for their verified email. */
export async function claimProjectInvite(confirm: boolean): Promise<ClaimProjectInviteResult> {
  const fn = httpsCallable<{ confirm: boolean }, ClaimProjectInviteResult>(
    functions,
    "claimProjectInvite",
  );
  const res = await fn({ confirm });
  return res.data;
}

export interface ProjectAcceptAddress {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
}

/**
 * Client accepts or declines a claimed project bundle. On accept, the client
 * confirms the structured job address (required) — accept then fans each job out
 * to the PM's preferred contractors as a scoped posting (P3b-2).
 */
export async function respondToProject(
  projectId: string,
  response: "accept" | "decline",
  address: ProjectAcceptAddress | null = null,
): Promise<{
  status: "accepted" | "declined";
  jobPostIds?: string[];
  dispatched?: boolean;
  unmatchedTrades?: string[];
}> {
  const fn = httpsCallable<
    {
      projectId: string;
      response: "accept" | "decline";
      address: ProjectAcceptAddress | null;
    },
    {
      status: "accepted" | "declined";
      jobPostIds?: string[];
      dispatched?: boolean;
      unmatchedTrades?: string[];
    }
  >(functions, "respondToProject");
  const res = await fn({ projectId, response, address });
  return res.data;
}

/**
 * Recover a project whose dispatch failed (accepted, but no postings). Either the
 * client or the owning PM can re-run it; refuses once the project already has postings.
 */
export async function redispatchProject(
  projectId: string,
): Promise<{ ok: true; jobPostIds: string[]; unmatchedTrades: string[] }> {
  const fn = httpsCallable<
    { projectId: string },
    { ok: true; jobPostIds: string[]; unmatchedTrades: string[] }
  >(functions, "redispatchProject");
  const res = await fn({ projectId });
  return res.data;
}

/** PM cancels a still-pending project (invited/claimed). */
export async function cancelProject(projectId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ projectId: string }, { ok: true }>(functions, "cancelProject");
  const res = await fn({ projectId });
  return res.data;
}

/**
 * PM re-sends a pending invite, optionally to a corrected email (which re-mints the
 * link). Returns a new inviteLink only when the email changed.
 */
export async function resendProjectInvite(
  projectId: string,
  newEmail?: string,
): Promise<{ ok: true; emailed: boolean; inviteLink: string | null }> {
  const fn = httpsCallable<
    { projectId: string; newEmail?: string },
    { ok: true; emailed: boolean; inviteLink: string | null }
  >(functions, "resendProjectInvite");
  const res = await fn(newEmail ? { projectId, newEmail } : { projectId });
  return res.data;
}

// ── Live reads ───────────────────────────────────────────────────────────────

// The PM's projects for the cockpit. Newest first, sorted client-side (a PM's
// project list is small — no composite index needed).
export function subscribeProjectsForPm(
  pmUid: string,
  cb: (rows: WithId<ProjectDoc>[]) => void,
): () => void {
  const q = query(projectsCol(), where("projectManagerId", "==", pmUid));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as WithId<ProjectDoc>)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    cb(rows);
  });
}

// A single project (live), for the PM's read-only detail view. The owning PM or
// linked client may read it (rules); null while loading / if denied.
export function subscribeProject(
  projectId: string,
  cb: (project: WithId<ProjectDoc> | null) => void,
): () => void {
  return onSnapshot(projectDocRef(projectId), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
}

// A client's claimed/accepted projects, for the client dashboard panel. Only
// projects whose invite they've claimed (clientId == uid) are readable.
export function subscribeClientProjects(
  clientId: string,
  cb: (rows: WithId<ProjectDoc>[]) => void,
): () => void {
  const q = query(projectsCol(), where("clientId", "==", clientId));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as WithId<ProjectDoc>)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    cb(rows);
  });
}
