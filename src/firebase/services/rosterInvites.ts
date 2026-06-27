import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { RosterInviteDoc, WithId } from "@/firebase/interfaces";

// rosterInvites/{id} — a PM's email invite to a tradesperson not yet on Blue
// Seal. Writes flow through callables (rules deny client writes); reads are
// owner-only, so the PM subscribes to their own invites by pmId.

/**
 * Invite a tradesperson to the PM's roster by name + email. The callable emails
 * a compliant invite; the invitee lands on the roster when they sign up as a
 * tradesperson with this email. `emailed` is false only when the CASL footer
 * isn't configured server-side (the invite is still recorded).
 */
export async function sendRosterInvite(
  name: string,
  email: string,
): Promise<{ inviteId: string; emailed: boolean }> {
  const fn = httpsCallable<{ name: string; email: string }, { inviteId: string; emailed: boolean }>(
    functions,
    "sendRosterInvite",
  );
  const res = await fn({ name, email });
  return res.data;
}

/** Cancel a pending invite (owner-only; no-op once joined/revoked). */
export async function revokeRosterInvite(inviteId: string): Promise<void> {
  const fn = httpsCallable<{ inviteId: string }, { ok: boolean }>(functions, "revokeRosterInvite");
  await fn({ inviteId });
}

/** Live list of this PM's roster invites, newest first. */
export function subscribeRosterInvites(
  pmUid: string,
  cb: (invites: WithId<RosterInviteDoc>[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "rosterInvites"), where("pmId", "==", pmUid), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WithId<RosterInviteDoc>)),
    (err) => console.warn("[Firestore] rosterInvites listener:", err.code, err.message),
  );
}
