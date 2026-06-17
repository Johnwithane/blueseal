import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { logAdminAction } from "../lib/audit";
import {
  deriveIsPro,
  syncSubscriptionMirror,
  type SubscriptionState,
} from "../lib/subscription";
import { assertQaProvisioningAllowed } from "./guard";

const Input = z.object({ pro: z.boolean() });

// ~100 years out — a "permanent" comp window for the duration of QA testing.
const FAR_FUTURE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * QA self-serve: toggle the caller's OWN Blue Seal Pro entitlement so a tester
 * can compare the free vs Pro experience (AI tools, client fee waiver, etc.)
 * without going through Stripe. Reuses the founding-comp mechanism: it only ever
 * sets/clears `proCompUntil` and never touches real Stripe fields, so a tester
 * who also holds a real subscription keeps it. `syncSubscriptionMirror` writes
 * both users/{uid}.subscription and the public tradespeople/{uid}.isPro mirror in
 * one call, so the two can't drift.
 */
export const qaSetSelfPro = onCall(CALLABLE_OPTS, async (req) => {
  const uid = assertQaProvisioningAllowed(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { pro } = parsed.data;

  const userRef = db.doc(`users/${uid}`);
  const existing = ((await userRef.get()).data()?.subscription ??
    null) as SubscriptionState | null;

  const proCompUntil = pro ? Timestamp.fromMillis(Date.now() + FAR_FUTURE_MS) : null;
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
    actorUid: uid,
    action: pro ? "qaGrantSelfPro" : "qaRevokeSelfPro",
    targetType: "user",
    targetId: uid,
  });

  const isPro = deriveIsPro(sub, Timestamp.now());
  logger.info("qaSetSelfPro", { uid, pro, isPro });
  return { ok: true, isPro };
});
