import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "@/firebase/config";

export async function uploadFile(path: string, file: File): Promise<string> {
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}

/**
 * Upload a file and return its storage path (NOT a download URL).
 *
 * Use this for buckets where the uploader does not have read access — most
 * notably `tradespeople/{uid}/id/*`, which is admin-read-only. Calling
 * `getDownloadURL` from the owner's client would 403, so we skip it and let
 * downstream consumers (the admin client) resolve the URL when needed.
 */
export async function uploadFileNoUrl(path: string, file: File): Promise<string> {
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return path;
}

export async function deleteFile(path: string): Promise<void> {
  await deleteObject(ref(storage, path));
}

/** Resolve a `fileRef` (either an `https://` download URL or a Storage path
 * like `tradespeople/{uid}/id/...`) to a download URL. Admin clients can
 * call this for buckets the owner can't read. */
export async function resolveFileUrl(fileRef: string): Promise<string> {
  if (fileRef.startsWith("http://") || fileRef.startsWith("https://")) return fileRef;
  return getDownloadURL(ref(storage, fileRef));
}

export function makeStoragePath(opts: {
  scope: "users" | "tradespeople" | "jobs" | "chats" | "invoices";
  id: string;
  bucket?: "profile" | "portfolio" | "certs" | "id" | "intake" | "insurance" | "wsib";
  filename: string;
}): string {
  const safe = opts.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = Date.now();
  if (opts.bucket) return `${opts.scope}/${opts.id}/${opts.bucket}/${ts}_${safe}`;
  return `${opts.scope}/${opts.id}/${ts}_${safe}`;
}
