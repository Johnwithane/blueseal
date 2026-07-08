import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";
import { firstNameOnly } from "../jobPosts/helpers";

/**
 * A PM adds a tradesperson to their preferred-trades roster via a direct client
 * write to users/{pmId}/savedTradies/{tradieId}. That routing change is
 * invisible to the tradesperson, so let them know their future matching project
 * jobs will now come to them to quote first (P2-22). Best-effort, in-app only
 * (low priority) — a courtesy, not time-critical. The paired roster-INVITE flow
 * (linkRosterInvitesOnSignup) is for not-yet-signed-up prospects; this fires
 * when the saved tradesperson already has an account.
 */
export const onRosterAdd = onDocumentCreated(
  "users/{pmId}/savedTradies/{tradieId}",
  async (event) => {
    const { pmId, tradieId } = event.params;
    if (!tradieId || pmId === tradieId) return;
    try {
      const pmSnap = await db.doc(`users/${pmId}`).get();
      const pmName =
        firstNameOnly((pmSnap.data() as { displayName?: string } | undefined)?.displayName) ||
        "A project manager";
      await notify({
        userId: tradieId,
        type: "roster_added",
        title: "Added to a roster",
        body: `${pmName} added you to their preferred trades — their matching project jobs will come to you to quote first.`,
        link: "/dashboard/tradie",
        actorUid: pmId,
        recipientRole: "tradesperson",
        priority: "low",
      });
    } catch (err) {
      logger.warn("onRosterAdd: notify failed", { pmId, tradieId, err });
    }
  },
);
