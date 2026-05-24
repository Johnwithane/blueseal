import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { VertexAI, type Part } from "@google-cloud/vertexai";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

/**
 * Vertex AI Gemini wrappers. No API key needed — the Cloud Function's
 * service account authenticates via ADC. Project + location are picked
 * up from the runtime env.
 *
 * One-time setup: enable the Vertex AI API on the GCP project:
 *   gcloud services enable aiplatform.googleapis.com --project blueseal-762af
 * (or click "Enable" in Cloud Console → APIs & Services). The Cloud Functions
 * service account gets access automatically.
 */

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "blueseal-762af";
const LOCATION = process.env.VERTEX_LOCATION || "us-central1";
const MODEL = process.env.VERTEX_MODEL || "gemini-2.5-flash";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  prompt: z.string().trim().max(2000).optional(),
});

function mimeForUrl(url: string): string {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

interface JobDoc {
  trade: string;
  title: string;
  description: string;
  intakeFormData: Record<string, unknown>;
  intakePhotos: string[];
  tradespersonId: string;
  clientId: string;
  chatId: string;
}

interface MessageDoc {
  senderId: string;
  text: string;
  createdAt?: FirebaseFirestore.Timestamp;
}

async function loadContext(jobId: string, callerUid: string) {
  const jobSnap = await db.doc(`jobs/${jobId}`).get();
  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = jobSnap.data() as JobDoc;
  if (job.tradespersonId !== callerUid) {
    throw new HttpsError("permission-denied", "Only the assigned tradesperson can use AI tools.");
  }

  const msgsSnap = await db
    .collection(`chats/${job.chatId}/messages`)
    .orderBy("createdAt", "asc")
    .limitToLast(30)
    .get();
  const messages: string[] = msgsSnap.docs.map((d) => {
    const m = d.data() as MessageDoc;
    const who = m.senderId === job.tradespersonId ? "Tradie" : "Client";
    return `${who}: ${m.text}`;
  });

  return { job, messages };
}

function buildPrompt(
  tool: "diagnose" | "quote" | "summary",
  job: JobDoc,
  messages: string[],
  extra?: string,
): string {
  const intake = Object.entries(job.intakeFormData)
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const chat = messages.join("\n");
  const header = `You are an assistant for a ${job.trade}. The job is "${job.title}".\n\nDescription: ${job.description}\n\nIntake details:\n${intake}\n\nRecent chat:\n${chat}\n`;

  switch (tool) {
    case "diagnose":
      return `${header}\n\nProvide three things, each as a numbered list:\n1. Likely causes (most likely first)\n2. Checks to perform on-site\n3. Parts or tools to bring\n\nExtra request from the tradie (may be empty): ${extra ?? ""}`;
    case "quote":
      return `${header}\n\nDraft a quote as a bulleted list of line items (description, estimated qty/hours, ballpark unit price in CAD). End with a one-line caveat that final pricing depends on on-site inspection.\n\nExtra request (may be empty): ${extra ?? ""}`;
    case "summary":
      return `${header}\n\nWrite a one-paragraph (~5 sentences) summary of this job suitable for the tradie's records.`;
  }
}

let vertexClient: VertexAI | null = null;
function client(): VertexAI {
  if (!vertexClient) {
    vertexClient = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  }
  return vertexClient;
}

async function runVertex(
  prompt: string,
  imageUrls: string[] = [],
): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  try {
    const model = client().getGenerativeModel({ model: MODEL });
    const parts: Part[] = [{ text: prompt }];
    for (const url of imageUrls.slice(0, 4)) {
      // Vertex accepts public HTTPS URIs and gs:// URIs. Storage download URLs are public per the
      // signed-URL token, so this works without additional auth setup.
      parts.push({ fileData: { mimeType: mimeForUrl(url), fileUri: url } });
    }
    const res = await model.generateContent({ contents: [{ role: "user", parts }] });
    const content =
      res.response.candidates?.[0]?.content?.parts
        ?.map((p) => ("text" in p ? p.text : ""))
        .join("") ?? "";
    return {
      content,
      tokensIn: res.response.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: res.response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (err) {
    logger.error("Vertex AI call failed", { error: (err as Error).message });
    // Never leak raw provider errors to the client — the message may contain
    // project IDs, internal hostnames, etc.
    throw new HttpsError(
      "internal",
      "The AI service is unavailable right now. Please try again shortly.",
    );
  }
}

async function logUsage(
  userId: string,
  jobId: string,
  tool: "diagnose" | "quote" | "summary",
  tokensIn: number,
  tokensOut: number,
) {
  await db.collection("aiUsage").add({
    userId,
    jobId,
    tool,
    tokensIn,
    tokensOut,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function makeTool(tool: "diagnose" | "quote" | "summary") {
  return onCall({ enforceAppCheck: false }, async (req) => {
    const uid = requireAuth(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

    const { job, messages } = await loadContext(parsed.data.jobId, uid);
    const prompt = buildPrompt(tool, job, messages, parsed.data.prompt);
    const result = await runVertex(prompt, job.intakePhotos);
    await logUsage(uid, parsed.data.jobId, tool, result.tokensIn, result.tokensOut);
    return { ok: true, ...result };
  });
}

export const aiDiagnose = makeTool("diagnose");
export const aiQuote = makeTool("quote");
export const aiSummarize = makeTool("summary");
