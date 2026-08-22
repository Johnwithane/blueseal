// Dispute evidence assembly.
//
// Blue Seal holds unusually strong chargeback evidence compared to a typical
// marketplace: a quote the client accepted by drawing a signature, an immutable
// chat thread (messages can't be edited or deleted), job photos, and explicit
// client sign-off timestamps. Until now all of that sat in Firestore while a
// human retyped it into the Stripe Dashboard against a deadline.
//
// This module turns those records into Stripe's evidence fields automatically.
//
// WE STAGE, WE DO NOT SUBMIT. Stripe allows exactly one submission per dispute
// and submitting closes the window to add anything better, so the webhook writes
// a DRAFT (`submit: false`) and an admin submits from the dispute detail view
// once they've reviewed it. Stripe auto-submits whatever is staged at the
// deadline, so a draft is strictly better than the nothing that was there
// before, even if nobody gets to it.
//
// Text-only by design: file evidence (the signature image, job photos) needs
// Stripe file uploads, which is a bigger change. The uncategorized_text
// narrative references those artifacts and the admin can attach them in the
// Dashboard before submitting.

import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import type { StripeClient } from "./stripeClient";

/** Stripe caps each evidence text field at 20k chars; stay clear of the edge. */
const TEXT_FIELD_CAP = 18_000;
/** Most recent chat messages to quote. Enough to show the arc, not the novel. */
const MAX_MESSAGES = 40;

export interface EvidenceMessage {
  at: Date | null;
  who: string;
  text: string;
}

export interface DisputeEvidenceFacts {
  jobTitle: string | null;
  jobDescription: string | null;
  trade: string | null;
  locality: string | null;
  jobCreatedAt: Date | null;
  scheduledStart: Date | null;
  completedAt: Date | null;
  clientApprovedAt: Date | null;
  quoteAcceptedAt: Date | null;
  quoteSigned: boolean;
  invoiceNumber: string | null;
  invoiceTotalCents: number | null;
  currency: string;
  paidAt: Date | null;
  lineItems: Array<{ description: string; amountCents: number | null }>;
  clientName: string | null;
  clientEmail: string | null;
  tradespersonName: string | null;
  messages: EvidenceMessage[];
  photoCount: number;
}

export interface StripeDisputeEvidence {
  product_description?: string;
  customer_name?: string;
  customer_email_address?: string;
  service_date?: string;
  uncategorized_text?: string;
}

/** Deterministic UTC date rendering — evidence read by a human at an issuer. */
function fmtDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

function fmtMoney(cents: number | null, currency: string): string | null {
  if (cents == null) return null;
  return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

function clamp(s: string, max = TEXT_FIELD_CAP): string {
  return s.length <= max ? s : `${s.slice(0, max - 20)}\n…[truncated]`;
}

/**
 * Turn job facts into Stripe evidence fields.
 *
 * Pure: no Firestore, no Stripe, no clock. The narrative it produces is the
 * thing that actually wins or loses a "service not received / not as described"
 * dispute, so its shape is pinned by unit tests rather than discovered in prod
 * against a 7-day deadline.
 */
export function buildDisputeEvidence(f: DisputeEvidenceFacts): StripeDisputeEvidence {
  const evidence: StripeDisputeEvidence = {};

  const descParts = [
    f.jobTitle,
    f.trade ? `Trade: ${f.trade}` : null,
    f.locality ? `Location: ${f.locality}` : null,
    f.jobDescription,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  if (descParts.length > 0) {
    evidence.product_description = clamp(descParts.join("\n"));
  }

  if (f.clientName) evidence.customer_name = clamp(f.clientName, 150);
  if (f.clientEmail) evidence.customer_email_address = clamp(f.clientEmail, 150);

  // Stripe wants the date the service was rendered. Completion is the truest
  // answer; fall back down the chain so the field is rarely empty.
  const serviceDate =
    fmtDate(f.completedAt) ?? fmtDate(f.scheduledStart) ?? fmtDate(f.jobCreatedAt);
  if (serviceDate) evidence.service_date = serviceDate;

  const lines: string[] = [];
  lines.push("BLUE SEAL — RECORD OF WORK AND AGREEMENT");
  lines.push(
    "Blue Seal is a marketplace that connects clients with verified tradespeople. " +
      "The records below are captured automatically by the platform as the job progresses.",
  );
  lines.push("");

  lines.push("PARTIES");
  if (f.clientName) lines.push(`  Client: ${f.clientName}`);
  if (f.clientEmail) lines.push(`  Client email: ${f.clientEmail}`);
  if (f.tradespersonName) {
    lines.push(`  Tradesperson: ${f.tradespersonName} (identity and trade certification verified by Blue Seal)`);
  }
  lines.push("");

  lines.push("AGREEMENT");
  if (f.quoteAcceptedAt) {
    lines.push(`  Quote accepted by the client: ${fmtDateTime(f.quoteAcceptedAt)}`);
  }
  if (f.quoteSigned) {
    lines.push(
      "  The client accepted the quote by drawing a signature in the Blue Seal app. " +
        "The signature image is retained as an immutable audit artifact and can be supplied on request.",
    );
  }
  if (!f.quoteAcceptedAt && !f.quoteSigned) {
    lines.push("  (No in-app quote acceptance recorded for this job.)");
  }
  lines.push("");

  lines.push("TIMELINE");
  const timeline: Array<[string, string | null]> = [
    ["Job created", fmtDateTime(f.jobCreatedAt)],
    ["Scheduled start", fmtDateTime(f.scheduledStart)],
    ["Work completed", fmtDateTime(f.completedAt)],
    ["Client approved the completed work", fmtDateTime(f.clientApprovedAt)],
    ["Invoice paid", fmtDateTime(f.paidAt)],
  ];
  for (const [label, value] of timeline) {
    if (value) lines.push(`  ${label}: ${value}`);
  }
  lines.push("");

  lines.push("INVOICE");
  if (f.invoiceNumber) lines.push(`  Invoice number: ${f.invoiceNumber}`);
  const total = fmtMoney(f.invoiceTotalCents, f.currency);
  if (total) lines.push(`  Invoice total: ${total}`);
  if (f.lineItems.length > 0) {
    lines.push("  Line items:");
    for (const li of f.lineItems) {
      const amount = fmtMoney(li.amountCents, f.currency);
      lines.push(`    - ${li.description}${amount ? ` — ${amount}` : ""}`);
    }
  }
  lines.push("");

  if (f.photoCount > 0) {
    lines.push(
      `PHOTOS\n  ${f.photoCount} photo(s) of the job were uploaded to Blue Seal and are available on request.`,
    );
    lines.push("");
  }

  if (f.messages.length > 0) {
    lines.push(
      "MESSAGES BETWEEN THE PARTIES (most recent last; Blue Seal chat messages " +
        "cannot be edited or deleted by either party)",
    );
    for (const m of f.messages.slice(-MAX_MESSAGES)) {
      const at = fmtDateTime(m.at);
      lines.push(`  [${at ?? "unknown time"}] ${m.who}: ${m.text.replace(/\s+/g, " ").trim()}`);
    }
    lines.push("");
  }

  evidence.uncategorized_text = clamp(lines.join("\n"));
  return evidence;
}

/** Firestore Timestamp-ish → Date, tolerating the several shapes we may read. */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === "function") {
    try {
      return t.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Gather everything Blue Seal knows about the job behind a dispute. */
export async function collectDisputeFacts(
  disputeId: string,
): Promise<DisputeEvidenceFacts | null> {
  const dSnap = await db.doc(`disputes/${disputeId}`).get();
  if (!dSnap.exists) return null;
  const d = dSnap.data() ?? {};
  const jobId = str(d.jobId);
  const invoiceId = str(d.invoiceId);

  const [jobSnap, invSnap, clientSnap, tradieSnap] = await Promise.all([
    jobId ? db.doc(`jobs/${jobId}`).get() : Promise.resolve(null),
    invoiceId ? db.doc(`invoices/${invoiceId}`).get() : Promise.resolve(null),
    str(d.clientId) ? db.doc(`users/${d.clientId}`).get() : Promise.resolve(null),
    str(d.tradespersonId)
      ? db.doc(`tradespeople/${d.tradespersonId}`).get()
      : Promise.resolve(null),
  ]);

  const job = jobSnap?.data() ?? {};
  const inv = invSnap?.data() ?? {};
  const client = clientSnap?.data() ?? {};
  const tradie = tradieSnap?.data() ?? {};

  // Chat lives at chats/{chatId} keyed by its own id, so find it by jobId.
  const messages: EvidenceMessage[] = [];
  if (jobId) {
    try {
      const chatQ = await db.collection("chats").where("jobId", "==", jobId).limit(1).get();
      if (!chatQ.empty) {
        const msgQ = await chatQ.docs[0].ref
          .collection("messages")
          .orderBy("createdAt", "asc")
          .limit(200)
          .get();
        const clientId = str(d.clientId);
        for (const m of msgQ.docs) {
          const md = m.data();
          const text = str(md.text);
          if (!text) continue;
          const sender = str(md.senderId);
          const who =
            sender === "system"
              ? "Blue Seal (system)"
              : sender && clientId && sender === clientId
                ? "Client"
                : "Tradesperson";
          messages.push({ at: toDate(md.createdAt), who, text });
        }
      }
    } catch (err) {
      // Evidence is better incomplete than absent.
      logger.warn("collectDisputeFacts: chat read failed", {
        disputeId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const address = (job.address ?? {}) as { city?: unknown; province?: unknown };
  const locality = [str(address.city), str(address.province)].filter(Boolean).join(", ") || null;

  const rawItems = Array.isArray(inv.lineItems) ? inv.lineItems : [];
  const lineItems = rawItems
    .map((li) => {
      const item = (li ?? {}) as { description?: unknown; total?: unknown; amount?: unknown };
      const description = str(item.description);
      if (!description) return null;
      const amount =
        typeof item.total === "number"
          ? item.total
          : typeof item.amount === "number"
            ? item.amount
            : null;
      return { description, amountCents: amount };
    })
    .filter((x): x is { description: string; amountCents: number | null } => x !== null);

  const quote = (job.quote ?? {}) as {
    acceptedAt?: unknown;
    signatureStoragePath?: unknown;
  };

  return {
    jobTitle: str(job.title),
    jobDescription: str(job.description),
    trade: str(job.trade),
    locality,
    jobCreatedAt: toDate(job.createdAt),
    scheduledStart: toDate(job.scheduledStart),
    completedAt: toDate(job.completedAt),
    clientApprovedAt: toDate(job.clientApprovedAt),
    quoteAcceptedAt: toDate(quote.acceptedAt),
    quoteSigned: !!str(quote.signatureStoragePath),
    invoiceNumber: str(inv.invoiceNumber),
    invoiceTotalCents: typeof inv.total === "number" ? inv.total : null,
    currency: str(inv.currency) ?? str(d.currency) ?? "CAD",
    paidAt: toDate(inv.paidAt),
    lineItems,
    clientName: str(client.displayName) ?? str(job.clientName),
    clientEmail: str(client.email),
    tradespersonName: str(tradie.companyName) ?? str(tradie.displayName) ?? str(job.tradespersonName),
    messages,
    photoCount: Array.isArray(job.intakePhotos) ? job.intakePhotos.length : 0,
  };
}

/**
 * Build the evidence for a dispute and write it to Stripe.
 *
 * `submit: false` (the default, and what the webhook uses) saves a draft the
 * admin can review. `submit: true` is the deliberate, one-shot submission an
 * admin triggers from the dispute detail view.
 */
export async function stageDisputeEvidence(
  stripe: StripeClient,
  opts: { disputeId: string; submit?: boolean },
): Promise<{ staged: boolean; submitted: boolean }> {
  const facts = await collectDisputeFacts(opts.disputeId);
  if (!facts) {
    logger.warn("stageDisputeEvidence: no dispute doc", { disputeId: opts.disputeId });
    return { staged: false, submitted: false };
  }
  const evidence = buildDisputeEvidence(facts);
  const submit = opts.submit === true;

  await stripe.disputes.update(opts.disputeId, { evidence, ...(submit ? { submit: true } : {}) });

  logger.info("stageDisputeEvidence: evidence written", {
    disputeId: opts.disputeId,
    submitted: submit,
    messageCount: facts.messages.length,
  });
  return { staged: true, submitted: submit };
}
