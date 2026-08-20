import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { postSystemMessage } from "../lib/chatSystemMessage";

interface JobLike {
  chatId?: string;
  status?: string;
  scheduledStart?: Timestamp | null;
  scheduledEnd?: Timestamp | null;
  cancelledBy?: string | null;
  cancelledReason?: string | null;
  pendingChange?: { type?: string } | null;
}

// User-facing status labels. Mirrors the picker in JobDetailView so the
// chat line reads the same way the tradie sees it in the status dropdown.
const STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  requested: "Requested",
  quoted: "Quoted",
  awaiting_upfront_payment: "Awaiting upfront payment",
  in_progress: "In progress",
  on_hold: "On hold",
  awaiting_client_approval: "Awaiting your approval",
  awaiting_payment: "Awaiting payment",
  complete: "Complete",
  reviewed: "Reviewed",
  cancelled: "Cancelled",
};

// Status transitions handled by the finish-job / approval / payment
// callables — each posts its own richer chat line (with totals, reason,
// invoice number) and we'd just double up if we also posted the generic
// "Status changed to X" message here.
function isApprovalFlowTransition(before: string | undefined, after: string | undefined): boolean {
  if (!before || !after) return false;
  const pair = `${before}->${after}`;
  return (
    pair === "in_progress->awaiting_client_approval" ||
    // Straight to awaiting_payment: either sendInvoice (hand-written invoice
    // put in front of the client) or submitJobForApproval with the approval
    // round-trip skipped. Both post their own line with the invoice + total.
    pair === "in_progress->awaiting_payment" ||
    pair === "awaiting_client_approval->awaiting_payment" ||
    pair === "awaiting_client_approval->in_progress" ||
    pair === "awaiting_payment->complete" ||
    // Quote-flow transitions covered by submitQuote / clientAcceptQuote.
    // Any source → quoted is the submit/resubmit path. quoted →
    // in_progress is the client-accept path (we skip the old
    // quote_accepted/scheduled gates and jump straight to active).
    after === "quoted" ||
    pair === "quoted->in_progress" ||
    // Upfront fee flow — both transitions carry richer messages from the
    // respective callables (clientAcceptQuote / markUpfrontFeePaid /
    // clientMarkUpfrontFeePaid). Generic line would just double up.
    pair === "quoted->awaiting_upfront_payment" ||
    pair === "awaiting_upfront_payment->in_progress" ||
    pair === "awaiting_upfront_payment->cancelled" ||
    // On-hold flow — respondJobChange (postpone accept) and resumeJob post
    // their own "on hold" / "resumed" lines, so any transition into or out of
    // on_hold is callable-owned.
    before === "on_hold" ||
    after === "on_hold"
  );
}

function fmtScheduleRange(start: Timestamp | null | undefined, end: Timestamp | null | undefined): string {
  if (!start || !end) return "";
  // Canada-localised, Toronto-time. Matches the user-facing convention
  // captured in [[project_target_market]].
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${fmt.format(start.toDate())} → ${fmt.format(end.toDate())}`;
}

function sameSchedule(a: JobLike, b: JobLike): boolean {
  const am = a.scheduledStart?.toMillis() ?? null;
  const bm = b.scheduledStart?.toMillis() ?? null;
  const ae = a.scheduledEnd?.toMillis() ?? null;
  const be = b.scheduledEnd?.toMillis() ?? null;
  return am === bm && ae === be;
}

/**
 * Post system messages in the job's chat when status or schedule changes.
 * One trigger covers both because scheduleJob() updates both fields in a
 * single write — handling them together lets us coalesce into one line
 * ("Scheduled for Tue, May 26, 9:00 AM → 11:00 AM") instead of two.
 *
 * cancelledBy === "system" suppresses the cancellation line — returnToApplicants
 * uses that sentinel when reopening a post, and the user is told via the
 * application_returned notification path instead.
 */
export const onJobUpdated = onDocumentUpdated("jobs/{jobId}", async (event) => {
  const before = event.data?.before.data() as JobLike | undefined;
  const after = event.data?.after.data() as JobLike | undefined;
  if (!before || !after) return;
  const chatId = after.chatId;
  if (!chatId) {
    logger.debug("onJobUpdated: no chatId, skipping", { jobId: event.params.jobId });
    return;
  }

  const statusChanged = before.status !== after.status;
  const scheduleChanged = !sameSchedule(before, after);

  // Cancellation gets a richer line that includes the reason.
  if (statusChanged && after.status === "cancelled") {
    if (after.cancelledBy === "system") return;
    // Accepted cancel-request: respondJobChange posts its own "Job cancelled"
    // line. Defer so the chat doesn't show it twice.
    if (before.pendingChange?.type === "cancel" && !after.pendingChange) return;
    const reason = (after.cancelledReason ?? "").trim();
    const tail = reason ? ` — "${reason}"` : "";
    await postSystemMessage(chatId, `Job cancelled${tail}`);
    return;
  }

  // Schedule writes update scheduledStart/End on an already-active job;
  // post a single line so the chat reflects the new booking time.
  if (scheduleChanged && after.scheduledStart && after.scheduledEnd) {
    const range = fmtScheduleRange(after.scheduledStart, after.scheduledEnd);
    await postSystemMessage(chatId, `Scheduled for ${range}`);
    return;
  }

  // Plain status change — but skip the ones the approval-flow callables
  // already covered with a richer message.
  if (statusChanged && after.status) {
    if (isApprovalFlowTransition(before.status, after.status)) return;
    const label = STATUS_LABEL[after.status] ?? after.status;
    await postSystemMessage(chatId, `Status changed to "${label}"`);
  }
});
