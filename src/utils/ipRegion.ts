// Coarse, no-prompt region from the visitor's IP address.
//
// Used only as a LAST-RESORT default for the search area when we have nothing
// better — no saved account address and no already-granted device GPS. It lets
// a first-time, logged-out visitor land on a search that's already centred near
// them instead of an empty location field, without triggering a permission
// prompt. The result is a *default the user can override*, never a stored fact.
//
// Best-effort by design: any failure (offline, blocked, CORS, ad-blocker,
// vendor down, unexpected shape) resolves to `null` and the caller falls back
// to the manual location picker. We never throw.
//
// Vendor: ipwho.is — keyless, CORS-enabled, free for commercial use. The only
// fields we read are { latitude, longitude, city, region }; swap IP_LOOKUP_URL
// if the vendor changes. Privacy: a client-side call sends the visitor's IP to
// this vendor (disclosed in the privacy policy under "Approximate location").

const IP_LOOKUP_URL = "https://ipwho.is/?fields=success,latitude,longitude,city,region";

export interface IpRegion {
  lat: number;
  lng: number;
  label: string;
}

export async function lookupIpRegion(signal?: AbortSignal): Promise<IpRegion | null> {
  try {
    const res = await fetch(IP_LOOKUP_URL, { signal });
    if (!res.ok) return null;

    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;

    // ipwho.is returns { success: false, message } on failure (e.g. rate limit).
    if (d.success !== true) return null;
    if (typeof d.latitude !== "number" || typeof d.longitude !== "number") return null;

    const label = [d.city, d.region]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .join(", ");

    return { lat: d.latitude, lng: d.longitude, label: label || "Your area" };
  } catch {
    return null; // offline / blocked / aborted / bad JSON — all non-fatal
  }
}
