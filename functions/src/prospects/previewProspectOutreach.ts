// Admin callable: render the outreach email EXACTLY as it will send, from the
// admin's current subject + edited message, so they can preview the branded
// HTML before sending. Reuses buildProspectOutreachEmail (the same builder the
// real send uses), so the preview can't drift from the real thing. When the
// CASL env isn't configured yet, the footer shows clear placeholders rather
// than failing — this is a preview, not a send.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import {
  appBaseUrl,
  buildProspectOutreachEmail,
  caslMailingAddress,
  caslOutreachBasisSentence,
  unsubTokenFor,
} from "./helpers";

const Input = z.object({
  prospectId: z.string().trim().min(1).max(64),
  subject: z.string().trim().min(1).max(160),
  bodyLines: z.array(z.string().trim().min(1).max(2000)).min(1).max(12),
});

export const previewProspectOutreach = onCall(CALLABLE_OPTS, async (req) => {
  requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { prospectId, subject, bodyLines } = parsed.data;

  const snap = await db.doc(`prospects/${prospectId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Prospect not found.");
  const p = snap.data() as Record<string, unknown>;
  const trade =
    Array.isArray(p.trades) && p.trades.length ? String(p.trades[0]) : "tradesperson";

  const mailingAddress =
    caslMailingAddress() ?? "[Your business mailing address — set BLUE_SEAL_MAILING_ADDRESS]";
  const unsubToken = unsubTokenFor(prospectId) ?? "preview";

  const { html } = buildProspectOutreachEmail({
    bodyLines,
    ctaLabel: "See your free profile",
    ctaUrl: `${appBaseUrl()}/p/${prospectId}`,
    senderName: process.env.BLUE_SEAL_LEGAL_NAME?.trim() || "Blue Seal",
    mailingAddress,
    basisSentence: caslOutreachBasisSentence(
      String(p.dataConsentBasis ?? ""),
      String(p.source ?? ""),
      trade,
    ),
    unsubUrl: `${appBaseUrl()}/p/unsubscribe?p=${encodeURIComponent(prospectId)}&t=${unsubToken}`,
  });

  return { subject, html };
});
