import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import {
  deriveIsPro,
  syncSubscriptionMirror,
  type SubscriptionState,
} from "../lib/subscription";

const Input = z.object({
  uid: z.string().min(1).max(128),
  // ISO 8601 datetime; the comp grants free Pro until this instant. null
  // revokes the comp (without touching any real Stripe subscription the
  // tradesperson may also hold).
  until: z.string().datetime().nullable(),
});

/**
 * Admin-only: grant (or revoke) a founding-member free Blue Seal Pro comp.
 *
 * Founding rollout (MONETIZATION.md): the early Okanagan cohort gets 3 months
 * of Pro on us before the AI gate ships, so nobody loses the assistant abruptly.
 * This sets users/{uid}.subscription.proCompUntil (leaving any real Stripe
 * fields intact) and mirrors the derived public isPro flag. deriveIsPro honors
 * proCompUntil with no Stripe involved; the scheduledProCompExpiry sweep flips
 * the mirror back when the comp lapses.
 *
 * Pass `until: null` to revoke.
 */
export const adminGrantFoundingPro = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { uid, until } = parsed.data;

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const existing = (userSnap.data()?.subscription ?? null) as SubscriptionState | null;
  const proCompUntil = until ? Timestamp.fromDate(new Date(until)) : null;

  // Merge onto any existing subscription so a comp never wipes a real Stripe
  // subscription (and vice-versa). Only proCompUntil + updatedAt change here.
  const sub: SubscriptionState = {
    status: existing?.status ?? "none",
    plan: existing?.plan ?? null,
    trialEndsAt: existing?.trialEndsAt ?? null,
    currentPeriodEnd: existing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? false,
    stripeCustomerId: existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
    everTrialedAt: existing?.everTrialedAt ?? null,
    proCompUntil,
    updatedAt: Timestamp.now(),
  };

  await syncSubscriptionMirror(uid, sub);

  await logAdminAction({
    actorUid: actor,
    action: until ? "grantFoundingPro" : "revokeFoundingPro",
    targetType: "user",
    targetId: uid,
    metadata: { proCompUntil: until },
  });

  const isPro = deriveIsPro(sub, Timestamp.now());
  logger.info("adminGrantFoundingPro", { actor, uid, proCompUntil: until, isPro });
  return { ok: true, isPro, proCompUntil: until };
});
