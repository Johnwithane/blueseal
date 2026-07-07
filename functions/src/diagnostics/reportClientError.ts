import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";

/**
 * Records a client-side error to `errorLogs` so admins get in-app visibility
 * into failures users hit (a failed form submit, a thrown render, an unhandled
 * rejection) instead of only Cloud Functions logs in the GCP console.
 *
 * Deliberately does NOT require auth: the most valuable silent failures (e.g.
 * an address autocomplete that never loaded) happen on public pages before the
 * user signs in, so requiring auth would drop exactly the cases this is for.
 * The abuse gate is App Check (CALLABLE_OPTS — enforced once provisioned) plus
 * the global maxInstances cap; every field is length-capped here so a runaway
 * loop or hostile caller can't bloat the collection. This is the same
 * unauthenticated-callable trade-off that retired `ping` — kept here on purpose
 * because telemetry needs the pre-auth window.
 *
 * Best-effort: never throws. A malformed payload or a write failure returns
 * `{ ok: false }` rather than surfacing noise to the client (which would itself
 * be a reportable error → a loop).
 */
const Input = z.object({
  message: z.string().trim().min(1).max(1000),
  // .nullable() throughout: the client always includes these keys and the
  // callable SDK delivers unset values as null, which bare .optional() rejects.
  // safeParse then returns {ok:false} and this fire-and-forget report is
  // silently dropped — so client error telemetry never reaches the admin queue
  // whenever a report lacks a stack/context (or appVersion is unset).
  stack: z.string().max(4000).nullable().optional(),
  source: z.enum(["vue", "window", "unhandledrejection", "manual"]).default("manual"),
  context: z.string().max(300).nullable().optional(),
  route: z.string().max(500).nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
  appVersion: z.string().max(80).nullable().optional(),
});

export const reportClientError = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) return { ok: false };
  const d = parsed.data;

  try {
    await db.collection("errorLogs").add({
      uid: req.auth?.uid ?? null,
      message: d.message,
      stack: d.stack ?? null,
      source: d.source,
      context: d.context ?? null,
      route: d.route ?? null,
      userAgent: d.userAgent ?? null,
      appVersion: d.appVersion ?? null,
      resolved: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    logger.error("reportClientError write failed", { err });
    return { ok: false };
  }
});
