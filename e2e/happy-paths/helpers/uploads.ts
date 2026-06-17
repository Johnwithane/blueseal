import { type Locator } from "@playwright/test";

// A tiny but valid PNG (1x1) passed as an in-memory buffer — the app compresses
// it to WebP client-side, so no fixture file on disk is needed.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);

export const DUMMY_IMAGE = { name: "qa-photo.png", mimeType: "image/png", buffer: PNG_1PX };
export const DUMMY_PDF = {
  name: "qa-doc.pdf",
  mimeType: "application/pdf",
  // Minimal valid PDF.
  buffer: Buffer.from(
    "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTkwCiUlRU9G",
    "base64",
  ),
};

export async function uploadImage(input: Locator): Promise<void> {
  await input.setInputFiles(DUMMY_IMAGE);
}
