import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { Role, UserDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

/**
 * If the user has a tradespeople doc, mirror denormalized profile fields
 * (displayName, photoURL) into it so the public profile page stays in sync.
 * Best-effort: failures shouldn't block the user-doc write that triggered it.
 */
async function mirrorProfileToTradieIfExists(
  uid: string,
  patch: { displayName?: string; photoURL?: string | null },
): Promise<void> {
  try {
    const tradieRef = doc(db, "tradespeople", uid);
    const snap = await getDoc(tradieRef);
    if (!snap.exists()) return;
    await updateDoc(tradieRef, patch);
  } catch {
    /* swallow — denormalization is best-effort */
  }
}

const usersCol = (uid: string) => doc(db, "users", uid).withConverter(typedConverter<UserDoc>());

/**
 * Reads a user doc and back-fills the multi-role shape from the legacy single
 * `role` field if a pre-cutover doc is encountered. Returns the doc in the
 * canonical `{ roles, activeRole }` shape regardless of what's stored.
 */
export async function getUser(uid: string): Promise<WithId<UserDoc> | null> {
  const snap = await getDoc(usersCol(uid));
  if (!snap.exists()) return null;
  const data = snap.data() as UserDoc & { role?: Role };
  // Legacy back-fill: pre-cutover docs only have `role`. Treat as a one-role array.
  if (!Array.isArray(data.roles) && data.role) {
    return {
      id: snap.id,
      ...data,
      roles: [data.role],
      activeRole: data.role,
    };
  }
  return { id: snap.id, ...data };
}

export async function createUser(opts: {
  uid: string;
  role: Role;
  email: string;
  displayName: string;
  photoURL?: string | null;
  phone?: string | null;
  termsAcceptedVersion: string;
}): Promise<void> {
  const ref = usersCol(opts.uid);
  // Use setDoc with merge:false so a duplicate signup throws — Cloud Function
  // setRoleOnSignup then mirrors `roles` to the custom claim.
  await setDoc(ref, {
    roles: [opts.role],
    activeRole: opts.role,
    displayName: opts.displayName,
    email: opts.email,
    photoURL: opts.photoURL ?? null,
    phone: opts.phone ?? null,
    createdAt: serverTimestamp() as never,
    lastActiveAt: serverTimestamp() as never,
    emailVerified: false,
    hasActiveSubscription: false,
    stripeCustomerId: null,
    clientRatingAvg: 0,
    clientRatingCount: 0,
    termsAcceptedAt: serverTimestamp() as never,
    termsAcceptedVersion: opts.termsAcceptedVersion,
    deletedAt: null,
    notificationPrefs: { emailEnabled: true, whatsappEnabled: true },
  });
}

/**
 * Admin user lookup. Tries to detect what kind of identifier was pasted
 * and runs the matching query; falls back across the three when the
 * format is ambiguous so support staff can paste in anything. Returns
 * up to 10 matches to keep the rendering tight.
 */
export async function searchUsers(input: string): Promise<WithId<UserDoc>[]> {
  const value = input.trim();
  if (!value) return [];
  const usersCol = collection(db, "users").withConverter(typedConverter<UserDoc>());

  // Cheap exact-match queries — Firestore can't do contains/prefix search
  // on strings without an external index. Email + phone + UID are exact
  // by their nature so this is the right shape for a support-lookup UX.
  const looksLikeEmail = /@/.test(value);
  const looksLikePhone = /^[+\d][\d\s\-()]+$/.test(value);

  // 1. UID — try a direct doc read first. Cheapest; works for any input
  //    that happens to be a Firebase Auth uid (~28 chars, no @).
  if (!looksLikeEmail && value.length >= 20 && value.length <= 64) {
    const direct = await getUser(value);
    if (direct) return [direct];
  }

  const results: WithId<UserDoc>[] = [];
  const seen = new Set<string>();

  if (looksLikeEmail) {
    const snap = await getDocs(
      query(usersCol, where("email", "==", value.toLowerCase()), fbLimit(10)),
    );
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      results.push({ id: d.id, ...d.data() });
    }
  }

  if (looksLikePhone) {
    // Phone may have been stored with or without formatting; the
    // searchable field is whatever the user entered on signup, so we
    // try both raw + stripped.
    const stripped = value.replace(/[^\d+]/g, "");
    for (const candidate of [value, stripped]) {
      const snap = await getDocs(
        query(usersCol, where("phone", "==", candidate), fbLimit(10)),
      );
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        results.push({ id: d.id, ...d.data() });
      }
    }
  }

  return results;
}

/** Save per-channel notification opt-outs. Owner-writable per Firestore rules. */
export async function updateNotificationPrefs(
  uid: string,
  prefs: { emailEnabled: boolean; whatsappEnabled: boolean },
): Promise<void> {
  await updateDoc(doc(db, "users", uid), { notificationPrefs: prefs });
}

/**
 * PIPEDA: request soft deletion of the signed-in user's account. The
 * callable runs as admin SDK, sets `deletedAt` on the user doc, and (if
 * tradesperson) hides their public profile so they stop appearing in
 * search immediately. Hard delete fires after a 30-day grace period via
 * the scheduledHardDelete function.
 */
export async function requestAccountDeletion(reason?: string): Promise<void> {
  const callable = httpsCallable<{ reason?: string }, { ok: boolean }>(
    functions,
    "requestAccountDeletion",
  );
  await callable({ reason });
}

/**
 * PIPEDA: trigger a JSON export of all the caller's data. The callable
 * assembles the export server-side, uploads it to Cloud Storage at
 * users/{uid}/exports/{ts}.json with a 30-day signed URL, and emails the
 * link. Returns the URL too so the UI can offer immediate download.
 */
export async function exportMyData(): Promise<{ url: string }> {
  const callable = httpsCallable<unknown, { url: string }>(functions, "exportMyData");
  const result = await callable({});
  return result.data;
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<Pick<UserDoc, "displayName" | "photoURL" | "phone">>,
): Promise<void> {
  await updateDoc(doc(db, "users", uid), { ...patch, lastActiveAt: serverTimestamp() });
  // Mirror name/photo into the tradesperson doc for the public profile page.
  const mirror: { displayName?: string; photoURL?: string | null } = {};
  if (patch.displayName !== undefined) mirror.displayName = patch.displayName;
  if (patch.photoURL !== undefined) mirror.photoURL = patch.photoURL;
  if (Object.keys(mirror).length > 0) await mirrorProfileToTradieIfExists(uid, mirror);
}

export async function updateUserPhoto(uid: string, photoURL: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), { photoURL, lastActiveAt: serverTimestamp() });
  await mirrorProfileToTradieIfExists(uid, { photoURL });
}

export async function touchUserActive(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), { lastActiveAt: serverTimestamp() });
}

/**
 * Switches the user's view-mode. Pure UI preference — rules let the owner
 * write activeRole as long as it's one of the roles they already hold.
 */
export async function setActiveRole(uid: string, role: Role): Promise<void> {
  await updateDoc(doc(db, "users", uid), { activeRole: role, lastActiveAt: serverTimestamp() });
}

/**
 * Server-side role grant. Adding "tradesperson" provisions a draft tradie
 * profile and starts the vetting flow; adding "client" is unrestricted.
 * Returns the updated roles array so callers can refresh local state.
 */
export async function addRoleToSelf(
  role: Exclude<Role, "admin">,
): Promise<{ roles: Role[]; activeRole: Role }> {
  const callable = httpsCallable<{ role: Role }, { roles: Role[]; activeRole: Role }>(
    functions,
    "addRoleToSelf",
  );
  const result = await callable({ role });
  return result.data;
}

/**
 * Admin-only testing helper: grants the calling admin all three roles +
 * provisions a visible, approved tradesperson profile so they can dogfood
 * the full client + tradesperson surface area.
 */
export async function grantAllRolesForAdminTesting(): Promise<{ roles: Role[] }> {
  const callable = httpsCallable<unknown, { ok: boolean; roles: Role[] }>(
    functions,
    "grantAllRolesForAdminTesting",
  );
  const result = await callable({});
  return { roles: result.data.roles };
}
