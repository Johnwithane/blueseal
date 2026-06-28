// Properties service (Project Manager). Pure async functions over the top-level
// `properties/{id}` collection (see PropertyDoc). A property is the PM's OWN record
// of an address/unit they manage. Mirrors the Clients CRM: read is ownership-only
// (plus a connected client), create/update require the projectManager role, and
// `linkedClientId` is server-managed.
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { PropertyDoc, WithId } from "@/firebase/interfaces";
import type { PropertyDraft } from "@/validation/properties";

const propertiesCol = () =>
  collection(db, "properties").withConverter(typedConverter<PropertyDoc>());
const propertyRef = (id: string) =>
  doc(db, "properties", id).withConverter(typedConverter<PropertyDoc>());

function requireUid(): string {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("You need to be signed in.");
  return uid;
}

function draftFields(draft: PropertyDraft) {
  return {
    label: draft.label,
    addressText: draft.addressText,
    notes: draft.notes,
    photoUrl: draft.photoUrl,
    units: draft.units,
  };
}

export async function createProperty(draft: PropertyDraft): Promise<string> {
  const uid = requireUid();
  const ref = await addDoc(propertiesCol(), {
    projectManagerId: uid,
    ...draftFields(draft),
    linkedClientId: null,
    archivedAt: null,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
  });
  return ref.id;
}

export async function updateProperty(id: string, draft: PropertyDraft): Promise<void> {
  await updateDoc(propertyRef(id), {
    ...draftFields(draft),
    updatedAt: serverTimestamp() as never,
  });
}

// Soft delete / restore — never hard-deleted by the PM (rules make delete
// admin-only), so any linked projects/jobs stay intact.
export async function setPropertyArchived(id: string, archived: boolean): Promise<void> {
  await updateDoc(propertyRef(id), {
    archivedAt: (archived ? serverTimestamp() : null) as never,
    updatedAt: serverTimestamp() as never,
  });
}

export async function getProperty(id: string): Promise<WithId<PropertyDoc> | null> {
  const snap = await getDoc(propertyRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listProperties(pmUid: string): Promise<WithId<PropertyDoc>[]> {
  const snap = await getDocs(query(propertiesCol(), where("projectManagerId", "==", pmUid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Live list for the cockpit. Archived hidden by default; sorted by label
// client-side (a PM's property book is small — no composite index needed).
export function subscribeProperties(
  pmUid: string,
  cb: (rows: WithId<PropertyDoc>[]) => void,
  opts: { includeArchived?: boolean } = {},
): () => void {
  const q = query(propertiesCol(), where("projectManagerId", "==", pmUid));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as WithId<PropertyDoc>)
      .filter((p) => opts.includeArchived || !p.archivedAt)
      .sort((a, b) => a.label.localeCompare(b.label));
    cb(rows);
  });
}
