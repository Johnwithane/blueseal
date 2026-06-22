// Trigger a browser "save file" for an in-memory Blob. Uses a transient object
// URL + a programmatic anchor click — the standard cross-browser path, and the
// one mobile Safari handles reliably (it hands the file to the OS viewer/Files,
// where the in-app rasterized preview falls down). Revokes the URL after the
// click so we don't leak object URLs.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
