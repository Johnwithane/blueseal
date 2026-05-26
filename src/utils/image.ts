/**
 * Client-side image compression for upload.
 *
 * - All image uploads must pass through this. Storage rules reject anything
 *   that isn't `image/webp` or `image/jpeg` (or `application/pdf` for
 *   certs/ID/receipts).
 * - Prefers WebP for size, falls back to JPEG when the browser doesn't
 *   encode WebP (see fallback note below).
 * - Uses an HTMLImageElement so HEIC works on iOS Safari (which decodes it
 *   natively) — `createImageBitmap` is less forgiving for HEIC.
 *
 * iOS Safari < 16.4 silently ignores `canvas.toBlob(..., "image/webp")`
 * and produces a PNG instead. The resulting blob's `type` is `image/png`,
 * but it's still non-null so the previous version of this function happily
 * wrapped it in a File claiming to be `image/webp`. At the default 2048px
 * cap a PNG of a phone-camera shot lands at 4–8 MB and trips Storage's
 * 4 MB size limit (a generic "User does not have permission to access ..."
 * error to the user). JPEG fallback fixes that: similar size to WebP for
 * photographic content, supported by every browser that can render an
 * `<img>`, and Storage rules accept it.
 */

export interface CompressOptions {
  /** Longest-edge cap in pixels. Larger images are scaled down preserving aspect. */
  maxDimension?: number;
  /** Encoder quality 0..1. Applied to both WebP and the JPEG fallback. */
  quality?: number;
}

const DEFAULTS = { maxDimension: 2048, quality: 0.85 };

export async function compressToWebp(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only images can be compressed. Got " + (file.type || "unknown type"));
  }
  // Already-WebP can still be re-encoded to apply the dimension cap.
  const { maxDimension, quality } = { ...DEFAULTS, ...opts };

  const img = await loadImage(file);
  let { naturalWidth: w, naturalHeight: h } = img;
  if (w === 0 || h === 0) throw new Error("Could not decode image");

  if (w > maxDimension || h > maxDimension) {
    const scale = maxDimension / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, w, h);

  // Try WebP. Inspect blob.type rather than trusting non-null — old iOS
  // Safari hands back a PNG (or whatever its default encoder is) silently.
  let blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality),
  );
  if (!blob || blob.type !== "image/webp") {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
  }
  if (!blob) throw new Error("Image encoding failed (browser supports neither WebP nor JPEG)");

  const baseName = file.name.replace(/\.[^.]+$/, "");
  // Match the extension to the actual blob type so the Storage rule's
  // filename check (e.g. `.*\.webp` / `.*\.(jpg|jpeg)`) lines up with the
  // contentType check. A WebP-named file with JPEG bytes would fail one
  // half of the rule on otherwise-valid uploads.
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `${baseName}.${ext}`, { type: blob.type });
}

/**
 * For certs/ID where PDFs are valid: passthrough PDFs untouched,
 * compress everything else as WebP.
 */
export async function compressOrPassPdf(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  if (file.type === "application/pdf") return file;
  return compressToWebp(file, opts);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image — file may be corrupted or unsupported format"));
    };
    img.src = url;
  });
}
