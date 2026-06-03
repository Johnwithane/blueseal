// supportTickets/{id} — Help Center contact-form messages.
//
// A signed-in user creates a ticket (validated client-side here and again by
// the Firestore rules); admins read the queue and change the status. There's
// no Cloud Function — it's a direct client create under tight rules. Signed-out
// visitors use the email (mailto) fallback in HelpContactForm instead, so this
// collection never takes unauthenticated writes.

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
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import type {
  SupportTicketDoc,
  SupportTicketStatus,
  WithId,
} from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import { supportTicketSchema, type SupportTicketInput } from "@/validation/schemas";

const ticketsCol = () =>
  collection(db, "supportTickets").withConverter(typedConverter<SupportTicketDoc>());
const ticketRef = (id: string) =>
  doc(db, "supportTickets", id).withConverter(typedConverter<SupportTicketDoc>());

/**
 * Create a support ticket. Requires a signed-in user (the rules enforce
 * `userId == uid`). Throws if the input is invalid or the user is signed out —
 * the caller catches and falls back to the email flow.
 */
export async function createSupportTicket(input: SupportTicketInput): Promise<string> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required to send a message.");
  const data = supportTicketSchema.parse(input);
  const ref = await addDoc(ticketsCol(), {
    userId: uid,
    name: data.name,
    email: data.email,
    topic: data.topic,
    message: data.message,
    status: "open",
    handledBy: null,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
  });
  return ref.id;
}

/**
 * Admin queue. Newest first; status is filtered client-side so we don't need a
 * composite index (createdAt is a single-field auto index).
 */
export async function listSupportTickets(): Promise<WithId<SupportTicketDoc>[]> {
  const snap = await getDocs(query(ticketsCol(), orderBy("createdAt", "desc"), limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Admin status change. The rules restrict the mutation to status/updatedAt/handledBy. */
export async function setSupportTicketStatus(
  id: string,
  status: SupportTicketStatus,
): Promise<void> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required.");
  await updateDoc(ticketRef(id), {
    status,
    handledBy: uid,
    updatedAt: serverTimestamp() as never,
  });
}
