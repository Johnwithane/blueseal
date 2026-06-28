import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";
import type { LineItem } from "@/firebase/interfaces";

// AI drafting callables — structured drafts the tradesperson reviews in the
// composer before anything is sent. Both are routed through the server-side
// entitlement seam (functions/src/lib/entitlements.ts): free today, slated
// for the Blue Seal Pro subscription, so callers should surface a friendly
// error if the gate ever flips on.

export interface AiQuoteDraft {
  lineItems: LineItem[];
  estimatedDuration: string;
  noteToClient: string;
  terms: string;
}

/**
 * Draft a quote from everything known about the work. Pass exactly one of:
 * - jobId  — direct-request job (uses job details + job chat)
 * - postId — job-board post (uses post details + your application Q&A thread)
 */
export async function draftQuoteWithAi(input: {
  jobId?: string;
  postId?: string;
}): Promise<AiQuoteDraft> {
  const fn = httpsCallable<typeof input, { ok: boolean; draft: AiQuoteDraft }>(
    functions,
    "aiDraftQuote",
  );
  const res = await fn(input);
  return res.data.draft;
}

export interface AiProjectJob {
  trade: string;
  title: string;
  description: string;
}

/**
 * Project manager: turn a freeform description of the work into a project's
 * trade jobs ({ trade, title, description }), which the PM then reviews + edits
 * in the new-project form before creating. Pass the allowed trades (key + label)
 * so the model picks valid trade keys. Blue Seal Pro (server-gated).
 */
export async function generateProjectJobsWithAi(
  prompt: string,
  trades: { key: string; label: string }[],
): Promise<AiProjectJob[]> {
  const fn = httpsCallable<
    { prompt: string; trades: { key: string; label: string }[] },
    { ok: boolean; jobs: AiProjectJob[] }
  >(functions, "aiGenerateProjectFromPrompt");
  const res = await fn({ prompt, trades });
  return res.data.jobs;
}

/** Draft the invoice wrap-up note from the job's tracked work. */
export async function draftInvoiceNoteWithAi(jobId: string): Promise<string> {
  const fn = httpsCallable<{ jobId: string }, { ok: boolean; note: string }>(
    functions,
    "aiDraftInvoiceNote",
  );
  const res = await fn({ jobId });
  return res.data.note;
}
