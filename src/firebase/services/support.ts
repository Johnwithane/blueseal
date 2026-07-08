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
  where,
} from "firebase/firestore";
import {
  ADMIN_QUEUE_ACTIONABLE_LIMIT,
  ADMIN_QUEUE_RECENT_LIMIT,
  mergeQueueDocs,
} from "@/utils/adminQueue";
import { httpsCallable } from "firebase/functions";
import { auth as fbAuth, db, functions } from "@/firebase/config";
import type {
  SupportReplyDoc,
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
    jobId: data.jobId ?? null,
    status: "open",
    handledBy: null,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
  });
  return ref.id;
}

/**
 * Admin queue. Two single-field-indexed queries merged (P3-06): every
 * still-actionable ticket (not `closed`) so an old open ticket can never fall
 * off the list, plus the most-recent N for closed/context. Status is still
 * filtered client-side in the view; this just guarantees the open set is whole.
 */
export async function listSupportTickets(): Promise<WithId<SupportTicketDoc>[]> {
  const [actionableSnap, recentSnap] = await Promise.all([
    getDocs(
      query(
        ticketsCol(),
        where("status", "in", ["open", "in_progress", "resolved"]),
        limit(ADMIN_QUEUE_ACTIONABLE_LIMIT),
      ),
    ),
    getDocs(query(ticketsCol(), orderBy("createdAt", "desc"), limit(ADMIN_QUEUE_RECENT_LIMIT))),
  ]);
  return mergeQueueDocs(
    actionableSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  );
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

/** Admin private triage notes (client write; allowed by the widened update rule). */
export async function setSupportInternalNotes(id: string, notes: string): Promise<void> {
  await updateDoc(ticketRef(id), {
    internalNotes: notes,
    updatedAt: serverTimestamp() as never,
  });
}

/** Admin: the replies already sent on a ticket (newest first). */
export async function listSupportReplies(ticketId: string): Promise<WithId<SupportReplyDoc>[]> {
  const snap = await getDocs(
    query(collection(db, "supportTickets", ticketId, "replies"), orderBy("sentAt", "desc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as SupportReplyDoc) }));
}

/** AI: draft 3 reply options for a ticket (admin-only Vertex callable). */
export async function aiDraftSupportReply(ticketId: string): Promise<string[]> {
  const callable = httpsCallable<{ ticketId: string }, { ok: boolean; suggestions: string[] }>(
    functions,
    "aiDraftSupportReply",
  );
  const res = await callable({ ticketId });
  return res.data.suggestions ?? [];
}

/**
 * Send a branded reply to the customer + record it on the ticket. mode "reply"
 * sets a monitored Reply-To; "noreply" is one-way. Optionally moves the status
 * (defaults to resolved server-side).
 */
export async function sendSupportTicketReply(input: {
  ticketId: string;
  body: string;
  mode: "reply" | "noreply";
  status?: SupportTicketStatus;
}): Promise<void> {
  const callable = httpsCallable<typeof input, { ok: boolean }>(functions, "sendSupportTicketReply");
  await callable(input);
}
