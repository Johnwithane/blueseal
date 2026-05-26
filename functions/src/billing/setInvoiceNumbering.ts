import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";

// Uppercase letters, digits, dashes. 1-10 chars; no leading/trailing dash
// so the stamped `${prefix}-${year}-${0001}` never collapses to a double-
// dash. Matches what tradies migrating from QuickBooks / FreshBooks / etc.
// would actually want to type ("ACME", "ACME-INV", "JS01").
const PREFIX_REGEX = /^[A-Z0-9](?:[A-Z0-9-]{0,8}[A-Z0-9])?$/;

const Input = z
  .object({
    invoicePrefix: z.string().min(1).max(10).regex(PREFIX_REGEX).optional(),
    quotePrefix: z.string().min(1).max(10).regex(PREFIX_REGEX).optional(),
    nextInvoiceNumber: z.number().int().min(1).max(999_999).optional(),
    nextQuoteNumber: z.number().int().min(1).max(999_999).optional(),
  })
  .refine(
    (v) =>
      v.invoicePrefix != null ||
      v.quotePrefix != null ||
      v.nextInvoiceNumber != null ||
      v.nextQuoteNumber != null,
    { message: "Provide at least one field to update." },
  );

/**
 * Lets a tradesperson customise the prefix on their generated invoice /
 * quote numbers, and seed the starting sequence when migrating from another
 * tracker. Stamp shape stays `${prefix}-${year}-${0001}`.
 *
 * Prefix changes are always allowed: old invoices keep their stamped
 * number, new ones use the new prefix. Sequence changes are only allowed
 * before the tradesperson has issued their first invoice/quote so the
 * counter stays monotonic — otherwise the platform-generated sequence
 * could collide with a previously-issued number. Once they've started
 * issuing through Blue Seal, mid-stream renumbering is admin-only.
 */
export const setInvoiceNumbering = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? parsed.error.message);
  }
  const { invoicePrefix, quotePrefix, nextInvoiceNumber, nextQuoteNumber } = parsed.data;

  const tradieRef = db.doc(`tradespeople/${uid}`);

  // Guard sequence changes — only allowed while no invoice/quote exists yet
  // for this tradesperson. Cheaper than fetching the whole counter history;
  // one indexed read per checked counter. Run in parallel since they're
  // independent.
  const [invoiceProbe, quoteProbe] = await Promise.all([
    nextInvoiceNumber != null
      ? db.collection("invoices").where("tradespersonId", "==", uid).limit(1).get()
      : null,
    nextQuoteNumber != null
      ? db.collection("quotes").where("tradespersonId", "==", uid).limit(1).get()
      : null,
  ]);

  if (nextInvoiceNumber != null && invoiceProbe && !invoiceProbe.empty) {
    throw new HttpsError(
      "failed-precondition",
      "You've already issued at least one invoice — the starting number can't be changed. Contact support if you need help with mid-stream renumbering.",
    );
  }
  if (nextQuoteNumber != null && quoteProbe && !quoteProbe.empty) {
    throw new HttpsError(
      "failed-precondition",
      "You've already issued at least one quote — the starting number can't be changed. Contact support if you need help with mid-stream renumbering.",
    );
  }

  const tradieSnap = await tradieRef.get();
  if (!tradieSnap.exists) {
    throw new HttpsError("not-found", "Tradesperson profile not found.");
  }

  const patch: Record<string, unknown> = {};
  if (invoicePrefix != null) patch.invoicePrefix = invoicePrefix;
  if (quotePrefix != null) patch.quotePrefix = quotePrefix;
  if (nextInvoiceNumber != null) patch.nextInvoiceNumber = nextInvoiceNumber;
  if (nextQuoteNumber != null) patch.nextQuoteNumber = nextQuoteNumber;

  await tradieRef.update(patch);

  logger.info("setInvoiceNumbering", { uid, fields: Object.keys(patch) });

  return { ok: true };
});
