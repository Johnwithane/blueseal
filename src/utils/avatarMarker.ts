// Airbnb-style circular avatar markers for a Google map.
//
// Rendered as OverlayView (not AdvancedMarkerElement) on purpose: OverlayView
// works on a plain raster map with NO cloud "Map ID", so this needs zero extra
// Google Cloud setup. It's display-only — the photo is never drawn to a canvas,
// so cross-origin logos/photos can't taint anything (no CORS surprises).

export interface AvatarMarkerData {
  id: string;
  lat: number;
  lng: number;
  photoURL?: string | null;
  // Shown when there's no photo (first letter of the name/trade).
  initial?: string;
  // Ring colour: verified members read brand-blue, seeded prospects muted —
  // mirrors the avatar treatment on TradieCard vs ProspectCard.
  variant?: "verified" | "prospect";
}

export interface AvatarMarkerLayer {
  setMarkers(markers: AvatarMarkerData[]): void;
  clear(): void;
}

const RING: Record<"verified" | "prospect", string> = {
  verified: "#1e88e5",
  prospect: "#9aa0a6",
};

// Build the marker DOM node with inline styles so it doesn't depend on any
// global stylesheet being loaded.
function buildEl(
  data: AvatarMarkerData,
  onClick?: (id: string) => void,
): HTMLDivElement {
  const ring = RING[data.variant ?? "verified"];
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    width: "44px",
    height: "44px",
    borderRadius: "9999px",
    border: `3px solid ${ring}`,
    background: "#fff",
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
    overflow: "hidden",
    cursor: onClick ? "pointer" : "default",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
  } as Partial<CSSStyleDeclaration>);

  if (data.photoURL) {
    const img = document.createElement("img");
    img.src = data.photoURL;
    img.alt = "";
    img.loading = "lazy";
    // cover here (not contain): on the map a filled circle reads cleaner than a
    // letterboxed one, and the avatars in results are already mostly square.
    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      objectFit: "cover",
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.textContent = (data.initial ?? "?").slice(0, 1).toUpperCase() || "?";
    Object.assign(span.style, {
      fontWeight: "600",
      color: ring,
      fontSize: "16px",
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(span);
  }

  if (onClick) {
    el.addEventListener("click", (e) => {
      e.stopPropagation(); // don't let the click re-center the search pin
      onClick(data.id);
    });
  }
  return el;
}

/**
 * Create a layer that renders circular avatar markers on `map`. Call
 * `setMarkers` whenever the result set changes; `clear` on teardown.
 */
export function createAvatarMarkerLayer(
  map: google.maps.Map,
  onClick?: (id: string) => void,
): AvatarMarkerLayer {
  // Defined here (not at module load) so google.maps is guaranteed loaded —
  // OverlayView only exists once the Maps JS API has initialised.
  class AvatarOverlay extends google.maps.OverlayView {
    private el: HTMLDivElement;
    private latLng: google.maps.LatLng;
    constructor(data: AvatarMarkerData) {
      super();
      this.el = buildEl(data, onClick);
      this.latLng = new google.maps.LatLng(data.lat, data.lng);
    }
    onAdd(): void {
      this.getPanes()?.overlayMouseTarget.appendChild(this.el);
    }
    draw(): void {
      const point = this.getProjection()?.fromLatLngToDivPixel(this.latLng);
      if (!point) return;
      this.el.style.left = `${point.x}px`;
      this.el.style.top = `${point.y}px`;
    }
    onRemove(): void {
      this.el.remove();
    }
  }

  let overlays: AvatarOverlay[] = [];

  function removeAll() {
    for (const o of overlays) o.setMap(null);
    overlays = [];
  }

  return {
    setMarkers(markers) {
      removeAll();
      overlays = markers.map((m) => {
        const o = new AvatarOverlay(m);
        o.setMap(map);
        return o;
      });
    },
    clear: removeAll,
  };
}
