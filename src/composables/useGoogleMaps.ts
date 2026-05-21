import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

interface MapsLibs {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  places: google.maps.PlacesLibrary;
}

let loadPromise: Promise<MapsLibs> | null = null;

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

  return { load };
}
