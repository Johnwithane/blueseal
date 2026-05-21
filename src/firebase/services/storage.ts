import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "@/firebase/config";

export async function uploadFile(path: string, file: File): Promise<string> {
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}

export async function deleteFile(path: string): Promise<void> {
  await deleteObject(ref(storage, path));
}

export function makeStoragePath(opts: {
  scope: "users" | "tradespeople" | "jobs" | "chats" | "invoices";
  id: string;
  bucket?: "profile" | "portfolio" | "certs" | "id" | "intake";
  filename: string;
}): string {
  const safe = opts.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = Date.now();
  if (opts.bucket) return `${opts.scope}/${opts.id}/${opts.bucket}/${ts}_${safe}`;
  return `${opts.scope}/${opts.id}/${ts}_${safe}`;
}
