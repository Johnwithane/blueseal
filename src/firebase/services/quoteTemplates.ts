import { db } from "@/firebase/config";
import type { LineItem, QuoteTemplateDoc, WithId } from "@/firebase/interfaces";
import { quoteTemplateSchema } from "@/validation/schemas";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

// tradespeople/{uid}/quoteTemplates — reusable scope-of-work blueprints.
// Owner-only (rules); rates ride along but the composer nudges a review on
// load since profile rates may have changed since the template was saved.

function templatesCol(uid: string) {
  return collection(db, "tradespeople", uid, "quoteTemplates");
}

export async function listQuoteTemplates(uid: string): Promise<WithId<QuoteTemplateDoc>[]> {
  const snap = await getDocs(query(templatesCol(uid), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WithId<QuoteTemplateDoc>);
}

export async function saveQuoteTemplate(
  uid: string,
  name: string,
  lineItems: LineItem[],
): Promise<string> {
  const parsed = quoteTemplateSchema.parse({ name, lineItems });
  const ref = await addDoc(templatesCol(uid), {
    ...parsed,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteQuoteTemplate(uid: string, templateId: string): Promise<void> {
  await deleteDoc(doc(db, "tradespeople", uid, "quoteTemplates", templateId));
}
