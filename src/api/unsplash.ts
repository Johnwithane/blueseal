// Unsplash image search — lets a tradesperson pick a banner / portfolio image
// from Unsplash instead of uploading their own. Uses the PUBLIC Access Key
// (read-only Search + Download endpoints) via Unsplash's documented Client-ID
// header. The whole feature hides when VITE_UNSPLASH_ACCESS_KEY is unset, so
// nothing breaks in environments without a key.
//
// Compliance notes (Unsplash API Guidelines):
//   - We ping `links.download_location` whenever a photo is actually chosen
//     (their required "download" trigger). See triggerUnsplashDownload.
//   - The picker shows photographer attribution + a link back to Unsplash.
//   - We re-host the chosen image to our own Storage (via the normal upload
//     pipeline) rather than hot-linking, so a tradesperson's banner doesn't
//     depend on Unsplash's CDN. Persistent on-profile attribution is a product
//     decision still to confirm — see HUMANTASKS.

const ACCESS_KEY = (import.meta.env.VITE_UNSPLASH_ACCESS_KEY ?? "").trim();
const API_BASE = "https://api.unsplash.com";
const UTM = "?utm_source=blue_seal&utm_medium=referral";

export interface UnsplashPhoto {
  id: string;
  description: string | null;
  thumbUrl: string; // small thumbnail for the grid
  regularUrl: string; // ~1080w — what we fetch + re-host
  downloadLocation: string; // ToS: ping when the photo is chosen
  authorName: string;
  authorLink: string; // photographer's Unsplash profile (for attribution)
  color: string | null; // dominant colour, used as a tile placeholder
}

export function isUnsplashEnabled(): boolean {
  return ACCESS_KEY.length > 0;
}

function authHeaders(): HeadersInit {
  return { Authorization: `Client-ID ${ACCESS_KEY}`, "Accept-Version": "v1" };
}

// Minimal shape of the bits of the Unsplash photo object we consume. The API
// returns far more; we narrow to what the picker needs (no `any`).
interface RawUnsplashUser {
  name?: string;
  username?: string;
}
interface RawUnsplashPhoto {
  id: string;
  description?: string | null;
  alt_description?: string | null;
  color?: string | null;
  urls?: { thumb?: string; small?: string; regular?: string };
  links?: { download_location?: string };
  user?: RawUnsplashUser;
}

function mapPhoto(r: RawUnsplashPhoto): UnsplashPhoto {
  return {
    id: r.id,
    description: r.description ?? r.alt_description ?? null,
    thumbUrl: r.urls?.thumb ?? r.urls?.small ?? "",
    regularUrl: r.urls?.regular ?? r.urls?.small ?? "",
    downloadLocation: r.links?.download_location ?? "",
    authorName: r.user?.name?.trim() || "Unsplash photographer",
    authorLink: r.user?.username
      ? `https://unsplash.com/@${r.user.username}${UTM}`
      : `https://unsplash.com${UTM}`,
    color: r.color ?? null,
  };
}

export interface UnsplashSearchResult {
  photos: UnsplashPhoto[];
  totalPages: number;
}

export async function searchUnsplash(
  query: string,
  page = 1,
  perPage = 24,
): Promise<UnsplashSearchResult> {
  const q = query.trim();
  if (!isUnsplashEnabled() || !q) return { photos: [], totalPages: 0 };
  const url =
    `${API_BASE}/search/photos?query=${encodeURIComponent(q)}` +
    `&page=${page}&per_page=${perPage}&content_filter=high`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Unsplash search failed (${res.status})`);
  const data = (await res.json()) as { results?: RawUnsplashPhoto[]; total_pages?: number };
  return {
    photos: (data.results ?? []).filter((r) => r?.id).map(mapPhoto),
    totalPages: data.total_pages ?? 0,
  };
}

// ToS: trigger a download event when the user actually selects a photo to use.
// Best-effort — never blocks the selection if it fails.
export async function triggerUnsplashDownload(downloadLocation: string): Promise<void> {
  if (!isUnsplashEnabled() || !downloadLocation) return;
  try {
    await fetch(downloadLocation, { headers: authHeaders() });
  } catch {
    /* best-effort analytics ping; ignore */
  }
}

// Fetch the chosen photo as a File so it runs through the SAME compress + upload
// pipeline as a normal upload (re-hosted to our Storage). Unsplash's image CDN
// is CORS-enabled, so the blob fetch works from the browser.
export async function fetchUnsplashAsFile(photo: UnsplashPhoto): Promise<File> {
  void triggerUnsplashDownload(photo.downloadLocation);
  const res = await fetch(photo.regularUrl);
  if (!res.ok) throw new Error("Couldn't fetch the selected image");
  const blob = await res.blob();
  return new File([blob], `unsplash-${photo.id}.jpg`, { type: blob.type || "image/jpeg" });
}
