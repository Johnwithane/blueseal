import { z } from "zod";
import { storage } from "./admin";

// A finger-drawn signature exported as an image data URL. We accept WebP
// (smallest, what the capture UI prefers), JPEG (the iOS Safari < 16.4 fallback
// — that Safari silently ignores the `image/webp` hint), and PNG (legacy
// captures + any other browser fallback). Real signatures encode to ~7–150 KB
// of base64; 300 KB is a generous cap that never rejects a legitimate signature
// while bounding payload abuse. The Zod check runs before we ever touch
// Buffer.from, so a malformed string is cheap to reject.
const SIGNATURE_MAX_LEN = 300 * 1024;
const SIGNATURE_DATA_URL_RE = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

// image/jpeg → .jpg; the rest map to their own name.
const EXT_FOR_FORMAT: Record<string, string> = { png: "png", webp: "webp", jpeg: "jpg" };

/**
 * Zod schema for an image data-URL signature payload. Shared by both accept
 * callables (clientAcceptQuote / acceptApplicationQuote) and the uninsured-work
 * waiver callable. Required wherever used — the signature IS the agreement.
 */
export const SignatureDataUrl = z
  .string()
  // Reject an empty / truncated canvas: prefix (~22 chars) + real base64.
  .min(120)
  .max(SIGNATURE_MAX_LEN)
  .regex(SIGNATURE_DATA_URL_RE, "Signature must be a PNG, WebP, or JPEG data URL.");

/** Decode a Zod-validated image data URL to a Buffer + its content type/ext. */
function decodeSignatureDataUrl(dataUrl: string): {
  buffer: Buffer;
  contentType: string;
  ext: string;
} {
  const m = SIGNATURE_DATA_URL_RE.exec(dataUrl);
  if (!m) throw new Error("Malformed signature data URL.");
  const format = m[1]; // png | webp | jpeg
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length < 200) {
    // Belt-and-suspenders against a near-empty canvas slipping past the string
    // length check (a blank image is small).
    throw new Error("Decoded signature is too small to be a real signature.");
  }
  return { buffer, contentType: `image/${format}`, ext: EXT_FOR_FORMAT[format] };
}

/**
 * Write a signature image to `${basePathNoExt}.{ext}` (extension derived from
 * the data URL's format) and return the full storage path to record.
 *
 * The base path is deterministic so a transaction retry — or an accidental
 * double-submit — overwrites the same object rather than accumulating
 * duplicates. Throws on upload failure; callers convert to HttpsError and abort
 * (never record an agreement without its signature).
 */
export async function writeSignatureAt(basePathNoExt: string, dataUrl: string): Promise<string> {
  const { buffer, contentType, ext } = decodeSignatureDataUrl(dataUrl);
  const path = `${basePathNoExt}.${ext}`;
  await storage.bucket().file(path).save(buffer, { contentType, resumable: false });
  return path;
}

/**
 * Write the client's quote-acceptance signature for a job. Path:
 * `jobs/{jobId}/signatures/quote-acceptance.{ext}` — server-write-only,
 * readable by both parties + admin (storage.rules). One canonical signature
 * per job.
 */
export async function writeQuoteSignature(jobId: string, dataUrl: string): Promise<string> {
  return writeSignatureAt(`jobs/${jobId}/signatures/quote-acceptance`, dataUrl);
}

/**
 * Write the tradesperson's "I'm working uninsured" waiver signature for a job.
 * Path: `jobs/{jobId}/signatures/uninsured-waiver-tradie.{ext}`. Same immutable
 * audit shape as the quote signature.
 */
export async function writeUninsuredWaiverSignature(jobId: string, dataUrl: string): Promise<string> {
  return writeSignatureAt(`jobs/${jobId}/signatures/uninsured-waiver-tradie`, dataUrl);
}
