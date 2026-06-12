import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

interface MapsLibs {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  places: google.maps.PlacesLibrary;
}

let loadPromise: Promise<MapsLibs> | null = null;

export interface GeocodeResult {
  lat: number;
  lng: number;
}

export function useGoogleMaps() {
  function load(): Promise<MapsLibs> {
    if (loadPromise) return loadPromise;

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Promise.reject(
        new Error("VITE_GOOGLE_MAPS_API_KEY is not set in .env"),
      );
    }

    setOptions({ key: apiKey, v: "weekly" });

    loadPromise = Promise.all([
      importLibrary("maps") as Promise<google.maps.MapsLibrary>,
      importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
      importLibrary("places") as Promise<google.maps.PlacesLibrary>,
    ])
      .then(([maps, marker, places]) => ({ maps, marker, places }))
      .catch((err: unknown) => {
        loadPromise = null;
        throw err;
      });

    return loadPromise;
  }

  /**
   * Forward-geocode a free-text address to coordinates. This is the fallback
   * for when coordinates didn't come from a Places autocomplete pick — e.g. the
   * user let the browser autofill the address fields (which fills the text but
   * never fires `place_changed`), or typed/edited the fields by hand. Restricted
   * to Canada to match the autocomplete. Returns null on no match / failure;
   * callers surface their own user-facing message.
   */
  async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
    const trimmed = address.trim();
    if (!trimmed) return null;
    try {
      await load();
      const geocoder = new google.maps.Geocoder();
      const { results } = await geocoder.geocode({
        address: trimmed,
        componentRestrictions: { country: "CA" },
      });
      const loc = results?.[0]?.geometry?.location;
      if (!loc) return null;
      return { lat: loc.lat(), lng: loc.lng() };
    } catch {
      return null;
    }
  }

  return { load, geocodeAddress };
}
