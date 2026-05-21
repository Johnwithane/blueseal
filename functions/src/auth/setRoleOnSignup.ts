import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { adminAuth } from "../lib/admin";

/**
 * When a `users/{uid}` doc is created, mirror its `role` field to the user's
 * Firebase Auth custom claims so security rules and callable wrappers can
 * gate without a Firestore read.
 */
export const setRoleOnSignup = onDocumentCreated("users/{uid}", async (event) => {
  const data = event.data?.data() as { role?: string } | undefined;
  const uid = event.params.uid;
  if (!data?.role) return;
  if (!["client", "tradesperson"].includes(data.role)) {
    logger.warn("Refusing to mirror invalid role from user doc", { uid, role: data.role });
    return;
  }
  // Don't downgrade an admin if for some reason their doc gets re-created.
  const current = await adminAuth.getUser(uid);
  const existingRole = (current.customClaims?.role as string | undefined) ?? null;
  if (existingRole === "admin") return;

  await adminAuth.setCustomUserClaims(uid, { role: data.role });
  logger.info("Mirrored role to claim", { uid, role: data.role });
});
