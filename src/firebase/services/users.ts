import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { Role, UserDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

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
  });
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<Pick<UserDoc, "displayName" | "photoURL" | "phone">>,
): Promise<void> {
  await updateDoc(doc(db, "users", uid), { ...patch, lastActiveAt: serverTimestamp() });
}

export async function updateUserPhoto(uid: string, photoURL: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), { photoURL, lastActiveAt: serverTimestamp() });
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
