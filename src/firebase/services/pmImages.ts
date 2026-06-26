// Shared photo upload for the Project Manager surfaces (property + project photos).
// Compresses to WebP and stores under projectManagers/{pmUid}/photos (owner-write,
// world-read), returning the download URL to stamp on the property/project doc.
import { compressToWebp } from "@/utils/image";
import { makeStoragePath, uploadFile } from "./storage";

export async function uploadPmPhoto(pmUid: string, file: File): Promise<string> {
  const compressed = await compressToWebp(file, { maxDimension: 1600, quality: 0.85 });
  const path = makeStoragePath({
    scope: "projectManagers",
    id: pmUid,
    bucket: "photos",
    filename: compressed.name,
  });
  return uploadFile(path, compressed);
}
