import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { VertexAI, type Part } from "@google-cloud/vertexai";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";

/**
 * Receipt OCR via Vertex AI Gemini. Reuses the same project / location /
 * model env vars as ai/tools.ts so a single VERTEX_MODEL bump moves both.
 *
 * Flow:
 *   1. Client uploads the receipt to jobs/{jobId}/receipts/{uuid}.{ext}
 *      (storage rules restrict the path to the assigned tradie + admin).
 *   2. Client creates a `parsing`-status expense doc with the storage path.
 *   3. Client calls parseReceipt({ jobId, expenseId }).
 *   4. This function fetches the file, asks Gemini for structured JSON,
 *      and writes the parsed fields back to the expense doc.
 *   5. On failure the doc flips to `ready` with aiParsed:false so the
 *      tradie can fill the fields in manually instead of being blocked.
 */

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "blueseal-762af";
const LOCATION = process.env.VERTEX_LOCATION || "us-central1";
const MODEL = process.env.VERTEX_MODEL || "gemini-2.5-flash";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  expenseId: z.string().min(1).max(128),
});

const Parsed = z.object({
  vendor: z.string().trim().max(200).nullable(),
  totalCost: z.number().int().min(0).max(100_000_000).nullable(), // cents
  spentAtIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  category: z
    .enum(["materials", "fuel", "disposal", "parking", "other"])
    .nullable(),
  suggestedDescription: z.string().trim().max(200).nullable(),
});

let vertexClient: VertexAI | null = null;
function client(): VertexAI {
  if (!vertexClient) vertexClient = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexClient;
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/webp";
}

const PROMPT = `You are parsing a tradesperson's expense receipt for a job.

Return ONLY a single JSON object with these keys (no markdown, no commentary):
{
  "vendor": string | null,           // store/business name as printed
  "totalCost": integer | null,       // grand total in CENTS (e.g. 4520 for $45.20). Include taxes.
  "spentAtIso": "YYYY-MM-DD" | null, // date on the receipt
  "category": "materials" | "fuel" | "disposal" | "parking" | "other" | null,
  "suggestedDescription": string | null  // short line a contractor could put on an invoice, max 80 chars
}

If a field is illegible or absent, use null. Do not invent values.
Common categories: hardware stores / lumber / plumbing supply = "materials";
gas stations = "fuel"; dump/landfill/junk haul = "disposal"; parking meters
or lots = "parking"; everything else = "other".`;

type ParsedReceipt = z.infer<typeof Parsed>;
const FALLBACK: ParsedReceipt = {
  vendor: null,
  totalCost: null,
  spentAtIso: null,
  category: null,
  suggestedDescription: null,
};

export const parseReceipt = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);

  const { jobId, expenseId } = parsed.data;
  const expenseRef = db.doc(`jobs/${jobId}/expenses/${expenseId}`);
  const expenseSnap = await expenseRef.get();
  if (!expenseSnap.exists) throw new HttpsError("not-found", "Expense not found.");
  const expense = expenseSnap.data() as {
    tradespersonId: string;
    receiptStoragePath: string;
  };
  if (expense.tradespersonId !== uid) {
    throw new HttpsError("permission-denied", "Not your expense.");
  }

  const tradieUserSnap = await db.doc(`users/${uid}`).get();
  const tradieUser = tradieUserSnap.data() as { hasActiveSubscription?: boolean } | undefined;
  if (!tradieUser?.hasActiveSubscription) {
    // Free tier: skip the AI call but flip status so the UI unlocks manual entry.
    await expenseRef.update({
      status: "ready",
      aiParsed: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError(
      "permission-denied",
      "Receipt OCR requires an active subscription. Fill the fields in manually.",
    );
  }

  // Fetch the file bytes from Storage. The function's service account has
  // bucket read access; no signed URL needed.
  const bucket = getStorage().bucket();
  let fileBytes: Buffer;
  try {
    const [buf] = await bucket.file(expense.receiptStoragePath).download();
    fileBytes = buf;
  } catch (err) {
    logger.error("receipt fetch failed", { jobId, expenseId, err: (err as Error).message });
    await expenseRef.update({
      status: "ready",
      aiParsed: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError("not-found", "Couldn't read the uploaded receipt.");
  }

  let parsedFields = FALLBACK;
  let aiParsed = false;
  try {
    const model = client().getGenerativeModel({ model: MODEL });
    const parts: Part[] = [
      { text: PROMPT },
      {
        inlineData: {
          mimeType: mimeForPath(expense.receiptStoragePath),
          data: fileBytes.toString("base64"),
        },
      },
    ];
    const res = await model.generateContent({ contents: [{ role: "user", parts }] });
    const raw =
      res.response.candidates?.[0]?.content?.parts
        ?.map((p) => ("text" in p ? p.text : ""))
        .join("") ?? "";
    // Strip code fences in case the model ignored "no markdown".
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const json = JSON.parse(cleaned);
    const validated = Parsed.safeParse(json);
    if (validated.success) {
      parsedFields = validated.data;
      aiParsed = true;
    } else {
      logger.warn("receipt parse: schema mismatch", { jobId, expenseId, issues: validated.error.issues });
    }
    const usage = res.response.usageMetadata;
    await db.collection("aiUsage").add({
      userId: uid,
      jobId,
      tool: "diagnose", // schema doesn't have "receipt" yet; reuse closest. TODO: extend.
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Don't fail the whole call — let the tradie type the fields manually.
    logger.error("Vertex receipt parse failed", { jobId, expenseId, err: (err as Error).message });
  }

  const spentAt = parsedFields.spentAtIso
    ? new Date(`${parsedFields.spentAtIso}T12:00:00Z`)
    : null;

  // Patch only the AI-derivable fields; leave tradie-controlled fields
  // (description override, markupPercent, billedAmount) untouched. If the
  // tradie hasn't typed a description yet (still the default empty string),
  // promote the AI suggestion so the row reads sensibly out of the box.
  const update: Record<string, unknown> = {
    vendor: parsedFields.vendor,
    spentAt: spentAt,
    category: parsedFields.category,
    status: "ready",
    aiParsed,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (parsedFields.totalCost != null) update.totalCost = parsedFields.totalCost;
  if (parsedFields.suggestedDescription) {
    const currentDesc = (expenseSnap.data() as { description?: string }).description ?? "";
    if (!currentDesc.trim()) update.description = parsedFields.suggestedDescription;
  }
  // Recompute billedAmount if we now have a totalCost and the tradie hasn't
  // overridden it yet (billedAmount === 0 implies untouched).
  const existing = expenseSnap.data() as { markupPercent?: number; billedAmount?: number };
  if (update.totalCost != null && (existing.billedAmount ?? 0) === 0) {
    const markup = existing.markupPercent ?? 15;
    update.billedAmount = Math.round((update.totalCost as number) * (1 + markup / 100));
  }
  await expenseRef.update(update);

  return { ok: true, aiParsed, ...parsedFields };
});
