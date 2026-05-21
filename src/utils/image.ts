/**
 * Client-side image compression to WebP.
 *
 * - All uploads must pass through this. Storage rules reject anything that
 *   isn't `image/webp` (or `application/pdf` for certs/ID).
 * - Uses an HTMLImageElement so HEIC works on iOS Safari (which decodes it
 *   natively) — `createImageBitmap` is less forgiving for HEIC.
 */

export interface CompressOptions {
  /** Longest-edge cap in pixels. Larger images are scaled down preserving aspect. */
  maxDimension?: number;
  /** WebP quality 0..1. */
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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality),
  );
  if (!blob) throw new Error("WebP encoding failed (browser may not support it)");

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.webp`, { type: "image/webp" });
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
