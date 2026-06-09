import { z } from "zod";
import { storage } from "./admin";

// A finger-drawn signature exported as a PNG data URL. Real signatures encode
// to ~7–150 KB of base64; 300 KB is a generous cap that never rejects a
// legitimate signature while bounding payload abuse. The Zod check runs before
// we ever touch Buffer.from, so a malformed string is cheap to reject.
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const SIGNATURE_MAX_LEN = 300 * 1024;

/**
 * Zod schema for a PNG data-URL signature payload. Shared by both accept
 * callables (clientAcceptQuote / acceptApplicationQuote). Required — the
 * signature IS the acceptance, so it's never optional.
 */
export const SignatureDataUrl = z
  .string()
  // Reject an empty / truncated canvas: prefix + a minimum of real base64.
  .min(PNG_DATA_URL_PREFIX.length + 100)
  .max(SIGNATURE_MAX_LEN)
  .regex(
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/,
    "Signature must be a PNG data URL.",
  );

/** Decode a Zod-validated PNG data URL to a Buffer. */
function decodePngDataUrl(dataUrl: string): Buffer {
  const b64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 200) {
    // Belt-and-suspenders against a near-empty canvas slipping past the string
    // length check (a blank PNG is small).
    throw new Error("Decoded signature is too small to be a real signature.");
  }
  return buf;
}

/**
 * Write the client's quote-acceptance signature for a job and return the
 * storage path to record on the quote doc.
 *
 * The path is deterministic (`jobs/{jobId}/signatures/quote-acceptance.png`)
 * so a transaction retry — or an accidental double-submit — overwrites the
 * same object rather than accumulating duplicates. One canonical signature per
 * job. Throws on upload failure; callers convert to HttpsError and abort the
 * acceptance (never accept without recording the signature).
 */
export async function writeQuoteSignature(jobId: string, dataUrl: string): Promise<string> {
  const path = `jobs/${jobId}/signatures/quote-acceptance.png`;
  const buffer = decodePngDataUrl(dataUrl);
  await storage.bucket().file(path).save(buffer, {
    contentType: "image/png",
    resumable: false,
  });
  return path;
}
