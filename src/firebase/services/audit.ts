import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { AuditLogDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const auditCol = () => collection(db, "auditLog").withConverter(typedConverter<AuditLogDoc>());

/**
 * Admin: the audit trail touching one user — actions taken ON them (targetId)
 * AND actions they performed (actorUid) — merged newest-first. Two queries
 * because Firestore can't OR across two fields; deduped by doc id (an action
 * where an admin acted on their own account would otherwise appear twice).
 * Needs the (targetId, createdAt DESC) + (actorUid, createdAt DESC) composite
 * indexes. `auditLog` is admin-read-only per firestore.rules.
 */
export async function listAuditForUser(
  uid: string,
  max = 50,
): Promise<WithId<AuditLogDoc>[]> {
  const [onUser, byUser] = await Promise.all([
    getDocs(query(auditCol(), where("targetId", "==", uid), orderBy("createdAt", "desc"), fbLimit(max))),
    getDocs(query(auditCol(), where("actorUid", "==", uid), orderBy("createdAt", "desc"), fbLimit(max))),
  ]);
  const byId = new Map<string, WithId<AuditLogDoc>>();
  for (const d of [...onUser.docs, ...byUser.docs]) byId.set(d.id, { id: d.id, ...d.data() });
  return [...byId.values()]
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
    .slice(0, max);
}
