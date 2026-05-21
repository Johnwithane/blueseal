import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

export interface AuditEntry {
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAdminAction(entry: AuditEntry): Promise<void> {
  await db.collection("auditLog").add({
    actorUid: entry.actorUid,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? {},
    createdAt: FieldValue.serverTimestamp(),
  });
}
