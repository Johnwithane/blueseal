import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { VouchDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import type {
  SendVouchRequestInput,
  VouchIdInput,
} from "@/validation/schemas";

const vouchesCol = () =>
  collection(db, "vouches").withConverter(typedConverter<VouchDoc>());

// ---------------------------------------------------------------------------
// Public profile reads — accepted vouches are world-readable so a viewer
// of /tradies/:uid can render the "Tradespeople I work with" and "Vouched
// for by" chip rows without needing to be signed in.
// ---------------------------------------------------------------------------

export async function listAcceptedVouchesFrom(
  uid: string,
): Promise<WithId<VouchDoc>[]> {
  const snap = await getDocs(
    query(
      vouchesCol(),
      where("fromUserId", "==", uid),
      where("status", "==", "accepted"),
      orderBy("respondedAt", "desc"),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listAcceptedVouchesFor(
  uid: string,
): Promise<WithId<VouchDoc>[]> {
  const snap = await getDocs(
    query(
      vouchesCol(),
      where("toUserId", "==", uid),
      where("status", "==", "accepted"),
      orderBy("respondedAt", "desc"),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// Manage-vouches view (owner only — rules permit reading own pending/declined
// vouches). Live subscriptions so accept/decline UI updates instantly.
// ---------------------------------------------------------------------------

export function subscribeMyOutgoingVouches(
  uid: string,
  cb: (vouches: WithId<VouchDoc>[]) => void,
): () => void {
  return onSnapshot(
    query(
      vouchesCol(),
      where("fromUserId", "==", uid),
      orderBy("createdAt", "desc"),
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export function subscribeMyIncomingVouches(
  uid: string,
  cb: (vouches: WithId<VouchDoc>[]) => void,
): () => void {
  return onSnapshot(
    query(
      vouchesCol(),
      where("toUserId", "==", uid),
      orderBy("createdAt", "desc"),
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

// ---------------------------------------------------------------------------
// Callable wrappers — every write happens server-side. Rules deny client
// writes to /vouches outright.
// ---------------------------------------------------------------------------

export async function sendVouchRequest(
  input: SendVouchRequestInput,
): Promise<{ vouchId: string; status: "pending_acceptance" | "pending_signup" }> {
  const callable = httpsCallable<
    SendVouchRequestInput,
    { vouchId: string; status: "pending_acceptance" | "pending_signup" }
  >(functions, "sendVouchRequest");
  const { data } = await callable(input);
  return data;
}

export async function acceptVouchRequest(vouchId: string): Promise<void> {
  const callable = httpsCallable<VouchIdInput, { ok: boolean }>(
    functions,
    "acceptVouchRequest",
  );
  await callable({ vouchId });
}

export async function declineVouchRequest(vouchId: string): Promise<void> {
  const callable = httpsCallable<VouchIdInput, { ok: boolean }>(
    functions,
    "declineVouchRequest",
  );
  await callable({ vouchId });
}

export async function revokeVouch(vouchId: string): Promise<void> {
  const callable = httpsCallable<VouchIdInput, { ok: boolean }>(
    functions,
    "revokeVouch",
  );
  await callable({ vouchId });
}
