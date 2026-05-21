import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { Role, UserDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const usersCol = (uid: string) => doc(db, "users", uid).withConverter(typedConverter<UserDoc>());

export async function getUser(uid: string): Promise<WithId<UserDoc> | null> {
  const snap = await getDoc(usersCol(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createUser(opts: {
  uid: string;
  role: Role;
  email: string;
  displayName: string;
  photoURL?: string | null;
  phone?: string | null;
}): Promise<void> {
  const ref = usersCol(opts.uid);
  // Use setDoc with merge:false so a duplicate signup throws — Cloud Function sets the role claim.
  await setDoc(ref, {
    role: opts.role,
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
  });
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<Pick<UserDoc, "displayName" | "photoURL" | "phone">>,
): Promise<void> {
  await updateDoc(doc(db, "users", uid), { ...patch, lastActiveAt: serverTimestamp() });
}

export async function touchUserActive(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), { lastActiveAt: serverTimestamp() });
}
