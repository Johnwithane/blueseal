// Clients book (CRM — Blue Seal Pro) service. Pure async functions over the
// top-level `clients/{id}` collection (see ClientDoc). A "client" here is the
// tradesperson's OWN contact record — it may have no Blue Seal account at all.
// Rules: read is ownership-only; create/update require an active Pro
// subscription; linkedUserId + activeRecurringPlans are server-managed.
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth as fbAuth, db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { ClientDoc, JobDoc, LineItem, WithId } from "@/firebase/interfaces";
import type { ClientDraft } from "@/validation/clients";

const clientsCol = () => collection(db, "clients").withConverter(typedConverter<ClientDoc>());
const clientRef = (id: string) => doc(db, "clients", id).withConverter(typedConverter<ClientDoc>());
const jobsCol = () => collection(db, "jobs").withConverter(typedConverter<JobDoc>());

function requireUid(): string {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("You need to be signed in.");
  return uid;
}

// Maps a validated draft to the contact-info subset of ClientDoc (the fields a
// tradesperson edits). Server-managed fields are added by create/update.
function draftFields(draft: ClientDraft) {
  return {
    displayName: draft.displayName,
    emailLower: draft.email,
    phone: draft.phone,
    company: draft.company,
    address: draft.address,
    notes: draft.notes,
  };
}

export async function createClient(
  draft: ClientDraft,
  source: ClientDoc["source"] = "manual",
): Promise<string> {
  const uid = requireUid();
  const ref = await addDoc(clientsCol(), {
    tradespersonId: uid,
    ...draftFields(draft),
    linkedUserId: null,
    activeRecurringPlans: 0,
    source,
    archivedAt: null,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
  });
  return ref.id;
}

// Bulk-create from a CSV import. The caller has already validated + deduped
// each draft. Chunked into batches well under Firestore's 500-write limit.
// Returns the number written.
export async function importClients(drafts: ClientDraft[]): Promise<number> {
  const uid = requireUid();
  let written = 0;
  for (let i = 0; i < drafts.length; i += 400) {
    const chunk = drafts.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const draft of chunk) {
      batch.set(doc(clientsCol()), {
        tradespersonId: uid,
        ...draftFields(draft),
        linkedUserId: null,
        activeRecurringPlans: 0,
        source: "import",
        archivedAt: null,
        createdAt: serverTimestamp() as never,
        updatedAt: serverTimestamp() as never,
      });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

export async function updateClient(id: string, draft: ClientDraft): Promise<void> {
  await updateDoc(clientRef(id), {
    ...draftFields(draft),
    updatedAt: serverTimestamp() as never,
  });
}

// Soft delete / restore — the doc is never hard-deleted by the tradesperson
// (rules make delete admin-only), so history + any linked jobs stay intact.
export async function setClientArchived(id: string, archived: boolean): Promise<void> {
  await updateDoc(clientRef(id), {
    archivedAt: (archived ? serverTimestamp() : null) as never,
    updatedAt: serverTimestamp() as never,
  });
}

export async function getClient(id: string): Promise<WithId<ClientDoc> | null> {
  const snap = await getDoc(clientRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// All of the tradesperson's contacts (a single-field equality query — no
// composite index needed). Used for import dedupe; includes archived so a
// re-import doesn't resurrect a duplicate of an archived contact.
export async function listClients(tradieUid: string): Promise<WithId<ClientDoc>[]> {
  const snap = await getDocs(query(clientsCol(), where("tradespersonId", "==", tradieUid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Live list for the Clients tab. Archived contacts are hidden by default and
// the list is sorted by name client-side (a contact book is small — no need
// for a composite index on tradespersonId + displayName).
export function subscribeClients(
  tradieUid: string,
  cb: (clients: WithId<ClientDoc>[]) => void,
  opts: { includeArchived?: boolean } = {},
): () => void {
  const q = query(clientsCol(), where("tradespersonId", "==", tradieUid));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as WithId<ClientDoc>)
      .filter((c) => opts.includeArchived || !c.archivedAt)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    cb(rows);
  });
}

// ---- Recurring billing (Blue Seal Pro) — callable wrappers ----
// A recurring charge is created server-side (hidden backing job + template
// invoice the engine clones each period). LineItem unitPrice is in CENTS.
export interface RecurringPlanInput {
  clientId: string;
  label: string;
  frequency: "weekly" | "monthly" | "quarterly";
  lineItems: Pick<LineItem, "description" | "quantity" | "unitPrice" | "taxRate">[];
  discount: { type: "percent" | "fixed"; value: number; label: string | null } | null;
}

export async function createRecurringPlan(
  input: RecurringPlanInput,
): Promise<{ jobId: string; invoiceId: string; total: number }> {
  const fn = httpsCallable(functions, "createRecurringPlan");
  const res = await fn(input);
  return res.data as { jobId: string; invoiceId: string; total: number };
}

// Pause / resume a plan (keeps the client's activeRecurringPlans badge correct
// server-side). planJobId is the backing job id.
export async function setRecurringPlanState(planJobId: string, enabled: boolean): Promise<void> {
  const fn = httpsCallable(functions, "setRecurringPlanState");
  await fn({ planJobId, enabled });
}

// Jobs linked to a contact (the per-client history rollup). Constrained by
// tradespersonId so the jobs read rule authorizes the query; needs the
// composite index jobs(tradespersonId, clientRef, createdAt desc). Returns
// every linked job — recurring backing jobs included — newest first.
export async function listClientJobs(
  tradieUid: string,
  clientId: string,
): Promise<WithId<JobDoc>[]> {
  const snap = await getDocs(
    query(
      jobsCol(),
      where("tradespersonId", "==", tradieUid),
      where("clientRef", "==", clientId),
      orderBy("createdAt", "desc"),
      limit(100),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
