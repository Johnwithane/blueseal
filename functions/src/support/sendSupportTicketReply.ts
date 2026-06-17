import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { enqueueMail } from "../lib/mail";
import { brandedEmailHtml } from "../lib/emailTemplate";

// Where customer replies land. In "reply" mode we set Reply-To here so a
// customer who hits reply reaches a monitored inbox (the From stays the verified
// no-reply sender). Override via the SUPPORT_REPLY_TO env var.
const SUPPORT_REPLY_TO = process.env.SUPPORT_REPLY_TO || "hello@blueseal.app";

const Input = z.object({
  ticketId: z.string().min(1).max(128),
  body: z.string().trim().min(1).max(5000),
  // "reply" routes responses to the monitored inbox; "noreply" sends a one-way
  // informational message (no Reply-To).
  mode: z.enum(["reply", "noreply"]),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
});

/**
 * Admin-only: send a branded reply to a support ticket through the Resend
 * pipeline, record it on the ticket (replies subcollection + lastReply*),
 * and move the ticket's status (default "resolved"). The reply body is admin-
 * authored (often from aiDraftSupportReply, then edited).
 */
export const sendSupportTicketReply = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { ticketId, body, mode, status } = parsed.data;

  const ref = db.doc(`supportTickets/${ticketId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Ticket not found.");
  const t = snap.data() as { email?: string; topic?: string };
  if (!t.email) throw new HttpsError("failed-precondition", "This ticket has no reply email.");

  const subject = `Re: [Support] ${t.topic ?? "Your Blue Seal request"}`;
  const bodyLines = body.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  await enqueueMail({
    to: t.email,
    subject,
    text: `${body}\n\n— The Blue Seal team`,
    html: brandedEmailHtml({ title: "A reply from Blue Seal support", bodyLines }),
    replyTo: mode === "reply" ? SUPPORT_REPLY_TO : undefined,
  });

  const token = req.auth?.token as { name?: string; email?: string } | undefined;
  await db.collection(`supportTickets/${ticketId}/replies`).add({
    senderUid: actor,
    senderName: token?.name || token?.email || "Support",
    body,
    mode,
    sentAt: FieldValue.serverTimestamp(),
  });

  const nextStatus = status ?? "resolved";
  await ref.set(
    {
      status: nextStatus,
      handledBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      lastReplyAt: FieldValue.serverTimestamp(),
      lastReplyBy: actor,
    },
    { merge: true },
  );

  await logAdminAction({
    actorUid: actor,
    action: "sendSupportTicketReply",
    targetType: "supportTicket",
    targetId: ticketId,
    metadata: { mode, status: nextStatus },
  });
  logger.info("sendSupportTicketReply", { actor, ticketId, mode, status: nextStatus });
  return { ok: true as const };
});
