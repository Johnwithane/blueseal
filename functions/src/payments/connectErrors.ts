// Shared Stripe error handling for the Connect callables.
//
// WHY THIS EXISTS: none of the Connect callables used to catch anything, so a
// Stripe rejection escaped `onCall` as a raw throw. The Firebase callable
// gateway turns that into a bare `INTERNAL` with no message, which is exactly
// what a tradesperson saw on "Start Stripe setup" after the live cutover — and
// the only record of what Stripe actually objected to was a stack trace in the
// Cloud Functions log. Every Stripe call in the Connect flow now goes through
// `callStripe`, so the failure is logged with Stripe's own error code + request
// id and the user gets a sentence they can act on.
//
// Stripe's raw message never reaches the client (per CLAUDE.md's callable
// pattern) — it can carry account ids and internal detail. It goes to the log;
// the client gets fixed copy.

import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

// stripe@22's CJS types entrypoint doesn't export the error classes, so we
// narrow structurally against the fields the SDK sets on every API error.
interface StripeErrorShape {
  type?: unknown;
  rawType?: unknown;
  code?: unknown;
  param?: unknown;
  statusCode?: unknown;
  requestId?: unknown;
  message?: unknown;
}

export interface StripeErrorInfo {
  type: string | null;
  code: string | null;
  param: string | null;
  statusCode: number | null;
  requestId: string | null;
  message: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Pull the diagnosable fields off a thrown Stripe error. All-null if it isn't one. */
export function stripeErrorInfo(err: unknown): StripeErrorInfo {
  const e = (err ?? {}) as StripeErrorShape;
  return {
    type: str(e.type) ?? str(e.rawType),
    code: str(e.code),
    param: str(e.param),
    statusCode: typeof e.statusCode === "number" ? e.statusCode : null,
    requestId: str(e.requestId),
    message: str(e.message),
  };
}

/**
 * True when Stripe says the id we sent doesn't exist *on the key we sent it
 * with*. The live cutover (2026-08-19) moved us to a different Stripe account,
 * not just a different mode, so every `acct_` minted during sandbox testing is
 * invisible to the live key and 404s like this. A stored id that trips this is
 * an orphan: it is not a live account holding money, it is a pointer into a
 * Stripe account we no longer talk to, and it is safe to discard.
 */
export function isMissingResource(err: unknown): boolean {
  const { code, statusCode, message } = stripeErrorInfo(err);
  if (code === "resource_missing") return true;
  return statusCode === 404 && /No such /i.test(message ?? "");
}

/**
 * Log a Stripe failure with everything needed to find it in the dashboard
 * (`requestId` is the search key), and return a client-safe HttpsError.
 * `ctx` should carry at least `{ fn, uid }`.
 */
export function stripeFailure(err: unknown, ctx: Record<string, unknown>): HttpsError {
  // An HttpsError we raised ourselves (e.g. a precondition) passes through
  // untouched — only genuine Stripe/transport failures get rewritten.
  if (err instanceof HttpsError) return err;

  const info = stripeErrorInfo(err);
  logger.error("stripe call failed", { ...ctx, stripe: info });

  if (isMissingResource(err)) {
    return new HttpsError(
      "failed-precondition",
      "Your payout account couldn't be found at Stripe. Tap Start Stripe setup to create a new one.",
    );
  }
  return new HttpsError(
    "internal",
    "Stripe couldn't complete that request. Please try again in a moment — if it keeps happening, contact support.",
  );
}

/** Run a Stripe call, converting any failure into a logged, client-safe HttpsError. */
export async function callStripe<T>(
  ctx: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw stripeFailure(err, ctx);
  }
}
