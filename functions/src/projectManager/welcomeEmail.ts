import { logger } from "firebase-functions/v2";
import { notify } from "../lib/notify";

/**
 * Best-effort welcome (email + in-app) the first time a user becomes a project
 * manager. Mirrors the tradesperson "you're approved" welcome (vetting/visibility),
 * but a PM is active immediately (no vetting), so it fires at provisioning. Always
 * best-effort: a mail hiccup must never fail the role-enable that triggered it.
 * Idempotent by construction — the call sites only run on the FIRST time the PM
 * role is added (addRoleToSelf returns early if the role already exists;
 * provisionAccount only creates a brand-new user doc).
 */
export async function sendPmWelcomeEmail(uid: string): Promise<void> {
  try {
    await notify({
      userId: uid,
      type: "pm_welcome",
      title: "Welcome to Blue Seal",
      body:
        "Your project-manager cockpit is ready. Start by adding the trades you trust, then add a " +
        "property and set up your first project for a client — each job goes to your trades for a quote.",
      link: "/manage",
      actorUid: null,
      recipientRole: "projectManager",
      priority: "high",
    });
  } catch (err) {
    logger.warn("sendPmWelcomeEmail failed", { uid, err });
  }
}
