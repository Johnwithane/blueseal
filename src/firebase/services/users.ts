import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  type QueryDocumentSnapshot,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/firebase/config";
import type { Role, SupportNoteDoc, UserDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

/**
 * If the user has a tradespeople doc, mirror denormalized profile fields
 * (displayName, photoURL) into it so the public profile page stays in sync.
 * Best-effort: failures shouldn't block the user-doc write that triggered it.
 */
async function mirrorProfileToTradieIfExists(
  uid: string,
  patch: { displayName?: string; photoURL?: string | null; bio?: string | null },
): Promise<void> {
  try {
    const tradieRef = doc(db, "tradespeople", uid);
    const snap = await getDoc(tradieRef);
    if (!snap.exists()) return;
    // tradesperson.bio is a non-nullable string; coerce a null bio (user
    // cleared their About me) into an empty string so the field stays
    // type-clean for the public profile read.
    const out: { displayName?: string; photoURL?: string | null; bio?: string } = {};
    if (patch.displayName !== undefined) out.displayName = patch.displayName;
    if (patch.photoURL !== undefined) out.photoURL = patch.photoURL;
    if (patch.bio !== undefined) out.bio = patch.bio ?? "";
    await updateDoc(tradieRef, out);
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

/**
 * Provisions the signed-in user's `users/{uid}` profile doc + role claims
 * SERVER-SIDE via the `provisionAccount` callable.
 *
 * Replaces the old client-side `setDoc(users/{uid})`, which was the first
 * Firestore write of a new session and raced the Auth→Firestore token
 * handshake — when the token wasn't attached yet the rules saw no auth,
 * `isOwner()` failed, and Firestore rejected with permission-denied (the
 * "You don't have permission to do that." users hit on signup). The callable
 * writes via the Admin SDK, which bypasses rules entirely, so there's no token
 * to race. Idempotent; returns the resulting roles so the caller can seed
 * local state without waiting for the claim trigger. `isNew` reports whether
 * this call actually created the doc (vs. reconciled an existing one), so OAuth
 * /magic-link callers can detect a brand-new account WITHOUT a racy client-side
 * users/{uid} read right after sign-in.
 */
export async function provisionAccount(input: {
  role: Role;
  displayName: string;
  termsAcceptedVersion: string;
  photoURL?: string | null;
  referralCode?: string;
  referralSignal?: "link" | "code" | "name";
  pmCode?: string;
}): Promise<{ roles: Role[]; activeRole: Role; isNew: boolean }> {
  const callable = httpsCallable<typeof input, { roles: Role[]; activeRole: Role; isNew: boolean }>(
    functions,
    "provisionAccount",
  );
  const result = await callable(input);
  return result.data;
}

// How many user docs we pull for the partial-name/partial-email fallback.
// Admin can read every user doc (rules), so the cost is fan-out reads —
// fine at MVP scale. Bump or switch to an external search index when the
// user table outgrows this.
const USER_SEARCH_FETCH_CAP = 500;

/**
 * Admin user lookup. Tries exact match on UID, email, and phone first
 * (cheap, deterministic). If the input doesn't unambiguously look like
 * one of those, OR none of them matched, falls back to a case-insensitive
 * substring scan over up to USER_SEARCH_FETCH_CAP recent users — matching
 * either `displayName` or `email`. Returns up to 10 results.
 *
 * Firestore can't do contains/prefix search on strings without an
 * external index, so the substring path is client-side filtering against
 * a paged read. At MVP scale that's the simplest thing that works; once
 * /users grows past ~1k we'll switch to Algolia/Typesense.
 */
export async function searchUsers(input: string): Promise<WithId<UserDoc>[]> {
  const value = input.trim();
  if (!value) return [];
  const usersCol = collection(db, "users").withConverter(typedConverter<UserDoc>());

  const looksLikeEmail = /@/.test(value);
  const looksLikePhone = /^[+\d][\d\s\-()]+$/.test(value);

  const results: WithId<UserDoc>[] = [];
  const seen = new Set<string>();
  const push = (doc: WithId<UserDoc>) => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    results.push(doc);
  };

  // 1. UID — try a direct doc read first. Cheapest; works for any input
  //    that happens to be a Firebase Auth uid (~28 chars, no @).
  if (!looksLikeEmail && value.length >= 20 && value.length <= 64) {
    const direct = await getUser(value);
    if (direct) push(direct);
  }

  // 2. Exact email — emails are stored lowercase on signup so we
  //    normalise the input before comparing.
  if (looksLikeEmail) {
    const snap = await getDocs(
      query(usersCol, where("email", "==", value.toLowerCase()), fbLimit(10)),
    );
    for (const d of snap.docs) push({ id: d.id, ...d.data() });
  }

  // 3. Exact phone — phone may have been stored with or without
  //    formatting, so we try both the raw and a digits-only variant.
  if (looksLikePhone) {
    const stripped = value.replace(/[^\d+]/g, "");
    for (const candidate of [value, stripped]) {
      const snap = await getDocs(
        query(usersCol, where("phone", "==", candidate), fbLimit(10)),
      );
      for (const d of snap.docs) push({ id: d.id, ...d.data() });
    }
  }

  // 4. Partial name / partial email fallback — scan a bounded page of
  //    users and filter client-side. Always runs in addition to the
  //    exact-match branches so a typo'd email or a name that looks like
  //    a UID still surfaces matches.
  const needle = value.toLowerCase();
  const snap = await getDocs(
    query(usersCol, orderBy("createdAt", "desc"), fbLimit(USER_SEARCH_FETCH_CAP)),
  );
  const partial: Array<{ doc: WithId<UserDoc>; rank: number }> = [];
  for (const d of snap.docs) {
    const data = d.data();
    const name = (data.displayName ?? "").toLowerCase();
    const email = (data.email ?? "").toLowerCase();
    if (!name && !email) continue;
    if (name.startsWith(needle) || email.startsWith(needle)) {
      partial.push({ doc: { id: d.id, ...data }, rank: 0 });
    } else if (name.includes(needle) || email.includes(needle)) {
      partial.push({ doc: { id: d.id, ...data }, rank: 1 });
    }
  }
  partial.sort((a, b) => a.rank - b.rank);
  for (const m of partial) {
    if (results.length >= 10) break;
    push(m.doc);
  }

  return results.slice(0, 10);
}

export interface UsersPage {
  users: WithId<UserDoc>[];
  /** Cursor for the next page — pass straight back in as `cursor`. */
  lastDoc: QueryDocumentSnapshot<UserDoc> | null;
  reachedEnd: boolean;
}

/**
 * Admin browse: one page of users, newest first. The cursor is the last
 * DocumentSnapshot of the previous page (NOT a Timestamp) — `createdAt` is a
 * serverTimestamp and two docs written in the same millisecond would otherwise
 * be skipped/duplicated at the page boundary; a snapshot cursor disambiguates
 * on the full order key. Browse is best-effort `createdAt`-desc: a legacy doc
 * with no `createdAt` won't appear here, so search stays the authoritative
 * lookup. Admin can read every user doc per firestore.rules.
 */
export async function listUsersPage(opts: {
  pageSize: number;
  cursor?: QueryDocumentSnapshot<UserDoc> | null;
}): Promise<UsersPage> {
  const usersCol = collection(db, "users").withConverter(typedConverter<UserDoc>());
  const snap = await getDocs(
    opts.cursor
      ? query(usersCol, orderBy("createdAt", "desc"), startAfter(opts.cursor), fbLimit(opts.pageSize))
      : query(usersCol, orderBy("createdAt", "desc"), fbLimit(opts.pageSize)),
  );
  return {
    users: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : (opts.cursor ?? null),
    reachedEnd: snap.docs.length < opts.pageSize,
  };
}

// ---- Admin support notes (users/{uid}/supportNotes) -----------------------
// Admin-only internal log. Direct Firestore writes (no callable): the rules
// gate it to admins and pin authorUid to the signed-in writer. See SupportNoteDoc.

export async function addSupportNote(targetUid: string, body: string): Promise<void> {
  const me = auth.currentUser;
  if (!me) throw new Error("You must be signed in.");
  await addDoc(collection(db, "users", targetUid, "supportNotes"), {
    authorUid: me.uid,
    authorName: me.displayName || me.email || "Admin",
    body,
    createdAt: serverTimestamp(),
  });
}

export async function listSupportNotes(targetUid: string): Promise<WithId<SupportNoteDoc>[]> {
  const snap = await getDocs(
    query(collection(db, "users", targetUid, "supportNotes"), orderBy("createdAt", "desc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as SupportNoteDoc) }));
}

export async function deleteSupportNote(targetUid: string, noteId: string): Promise<void> {
  await deleteDoc(doc(db, "users", targetUid, "supportNotes", noteId));
}

/** Save per-channel notification opt-outs. Owner-writable per Firestore rules. */
export async function updateNotificationPrefs(
  uid: string,
  prefs: {
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    newJobPostingEnabled?: boolean;
  },
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
  patch: Partial<Pick<UserDoc, "displayName" | "photoURL" | "phone" | "bio">>,
): Promise<void> {
  await updateDoc(doc(db, "users", uid), { ...patch, lastActiveAt: serverTimestamp() });
  // Mirror name/photo/bio into the tradesperson doc so the public profile
  // page (which only reads from tradespeople/{uid}) reflects them. Bio is
  // canonically on the user doc; this mirror keeps the public view fresh
  // without forcing TradieProfileView to do an extra user-doc read.
  const mirror: { displayName?: string; photoURL?: string | null; bio?: string | null } = {};
  if (patch.displayName !== undefined) mirror.displayName = patch.displayName;
  if (patch.photoURL !== undefined) mirror.photoURL = patch.photoURL;
  if (patch.bio !== undefined) mirror.bio = patch.bio;
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
 * Reconciles the signed-in user's roles: applies implied-role invariants on
 * the doc (currently: tradesperson ⇒ client) AND mirrors doc roles into the
 * auth custom claims when they've diverged. Awaiting this before a token
 * refresh guarantees the refreshed token carries the doc's roles — the
 * signup paths rely on that to beat the async setRoleOnSignup trigger.
 * Idempotent and `activeRole`-preserving; returns whether anything changed
 * plus the resulting roles. Also called defensively on session init — see
 * useAuthStore.applyAuthState.
 */
export async function ensureSelfRoles(): Promise<{ changed: boolean; roles: Role[] }> {
  const callable = httpsCallable<unknown, { changed: boolean; roles: Role[] }>(
    functions,
    "ensureSelfRoles",
  );
  const result = await callable({});
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

/**
 * Admin-only testing helper: ensures the calling admin has a visible, approved
 * tradesperson profile and attaches *every* trade (marked verified) so they can
 * exercise trade-specific flows. One-way — trim trades via the trades editor.
 */
export async function grantAllTradesForAdminTesting(): Promise<{ count: number }> {
  const callable = httpsCallable<unknown, { ok: boolean; count: number }>(
    functions,
    "grantAllTradesForAdminTesting",
  );
  const result = await callable({});
  return { count: result.data.count };
}
