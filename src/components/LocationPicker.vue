<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import Slider from "primevue/slider";
import Button from "primevue/button";
import Message from "primevue/message";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import {
  createAvatarMarkerLayer,
  type AvatarMarkerData,
  type AvatarMarkerLayer,
} from "@/utils/avatarMarker";

export interface LocationValue {
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  label?: string;
  // Postal code from the pin's reverse-geocode. Its FSA (first 3 chars) maps a
  // tradesperson to a sales region (see matchRegionId). May be absent for rural
  // points the geocoder can't resolve to a postal code.
  postalCode?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: LocationValue;
    minRadius?: number;
    maxRadius?: number;
    country?: string;
    // Optional Airbnb-style result pins drawn on the same map.
    markers?: AvatarMarkerData[];
    // Map gesture mode. "cooperative" (default) lets a one-finger drag scroll
    // the page when the picker is inline mid-form. "greedy" lets scroll/drag
    // zoom & pan the map directly — use it when the picker is inside a modal,
    // where there's no page scroll to trap.
    gesture?: "greedy" | "cooperative" | "auto" | "none";
  }>(),
  {
    minRadius: 1,
    maxRadius: 200,
    country: "",
    markers: () => [],
    gesture: "cooperative",
  },
);

const countryRestriction =
  (props.country || import.meta.env.VITE_DEFAULT_REGION || "").toLowerCase();

const emit = defineEmits<{
  "update:modelValue": [value: LocationValue];
  // Fired when a result pin is tapped (carries the tradie/prospect id).
  "marker-click": [id: string];
}>();

const mapEl = ref<HTMLDivElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const status = ref<string | null>(null);
const loading = ref(true);
const label = ref(props.modelValue.label ?? "");
const postalCode = ref(props.modelValue.postalCode ?? "");
const radiusKm = ref(props.modelValue.radiusKm || 50);

let map: google.maps.Map | null = null;
let marker: google.maps.Marker | null = null;
let circle: google.maps.Circle | null = null;
let autocomplete: google.maps.places.Autocomplete | null = null;
let markerLayer: AvatarMarkerLayer | null = null;
let geocoder: google.maps.Geocoder | null = null;
// Guards against out-of-order reverse-geocode results when the point changes
// quickly (drag, repeated clicks) — only the latest lookup applies its label.
let citySeq = 0;

// Address-component types to try, most-specific city first.
const CITY_TYPES = [
  "locality",
  "postal_town",
  "sublocality",
  "administrative_area_level_3",
  "administrative_area_level_2",
];

// Reverse-geocode the chosen point to its nearest city and use that as the
// label (the user wants the city name, not a raw address / "Selected area").
async function resolveCityLabel(lat: number, lng: number): Promise<void> {
  const seq = ++citySeq;
  try {
    if (!geocoder) geocoder = new google.maps.Geocoder();
    const { results } = await geocoder.geocode({ location: { lat, lng } });
    if (seq !== citySeq || !results?.length) return; // a newer point won
    let city: string | null = null;
    for (const type of CITY_TYPES) {
      for (const r of results) {
        const comp = r.address_components?.find((c) => c.types.includes(type));
        if (comp) {
          city = comp.long_name;
          break;
        }
      }
      if (city) break;
    }
    // Postal code for region assignment (its FSA = the first 3 chars). Cleared
    // when the new point has none, so a stale code never lingers on the value.
    let postal: string | null = null;
    for (const r of results) {
      const comp = r.address_components?.find((c) => c.types.includes("postal_code"));
      if (comp) {
        postal = comp.long_name;
        break;
      }
    }
    postalCode.value = postal ?? "";
    if (city) label.value = city;
    emitChange(lat, lng, label.value);
  } catch {
    /* geocoding failed (quota / network) — keep whatever label we have */
  }
}

function emitChange(lat: number | null, lng: number | null, newLabel?: string) {
  emit("update:modelValue", {
    lat,
    lng,
    radiusKm: radiusKm.value,
    label: (newLabel ?? label.value) || undefined,
    postalCode: postalCode.value || undefined,
  });
}

function fitToCircle() {
  if (!map || !circle) return;
  const bounds = circle.getBounds();
  if (bounds) map.fitBounds(bounds, 24);
}

function setLocation(lat: number, lng: number, newLabel?: string) {
  if (!map) return;
  const pos = { lat, lng };

  if (!marker) {
    marker = new google.maps.Marker({
      map,
      position: pos,
      draggable: true,
    });
    marker.addListener("dragend", () => {
      const p = marker?.getPosition();
      if (!p) return;
      label.value = "";
      circle?.setCenter({ lat: p.lat(), lng: p.lng() });
      fitToCircle();
      emitChange(p.lat(), p.lng(), "");
      void resolveCityLabel(p.lat(), p.lng());
    });
  } else {
    marker.setPosition(pos);
  }

  if (!circle) {
    circle = new google.maps.Circle({
      map,
      center: pos,
      radius: radiusKm.value * 1000,
      strokeColor: "#0d47a1",
      strokeOpacity: 0.7,
      strokeWeight: 1,
      fillColor: "#1e88e5",
      fillOpacity: 0.15,
      clickable: false,
    });
  } else {
    circle.setCenter(pos);
  }

  if (newLabel !== undefined) label.value = newLabel;
  fitToCircle();
  emitChange(lat, lng, newLabel);
  // Always resolve the point to its nearest city for the label.
  void resolveCityLabel(lat, lng);
}

function useMyLocation() {
  if (!navigator.geolocation) {
    status.value = "Geolocation is not available in this browser.";
    return;
  }
  status.value = null;
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, "Current location"),
    (err) => (status.value = err.message),
  );
}

watch(radiusKm, (km) => {
  if (circle) {
    circle.setRadius(km * 1000);
    fitToCircle();
  }
  emit("update:modelValue", {
    ...props.modelValue,
    radiusKm: km,
    label: label.value || undefined,
  });
});

// Re-render the result pins whenever the parent's marker set changes
// (e.g. a fresh search returns different results).
watch(
  () => props.markers,
  (m) => markerLayer?.setMarkers(m),
);

onMounted(async () => {
  try {
    await useGoogleMaps().load();
  } catch (e) {
    status.value = (e as Error).message;
    loading.value = false;
    return;
  }

  const hasInitial =
    props.modelValue.lat != null && props.modelValue.lng != null;
  const center = hasInitial
    ? { lat: props.modelValue.lat!, lng: props.modelValue.lng! }
    : { lat: 56.1304, lng: -106.3468 }; // Canada centroid

  map = new google.maps.Map(mapEl.value!, {
    center,
    zoom: hasInitial ? 10 : 4,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    // Gesture mode is caller-controlled (see the `gesture` prop). In the
    // search popup it's "greedy" so scroll/drag zoom & pan the map directly;
    // inline forms use "cooperative" so a one-finger drag scrolls the page.
    gestureHandling: props.gesture,
  });

  // Airbnb-style result pins layer. Tapping a pin bubbles the id up so the
  // parent can open that profile.
  markerLayer = createAvatarMarkerLayer(map, (id) => emit("marker-click", id));
  markerLayer.setMarkers(props.markers);

  if (hasInitial) {
    setLocation(props.modelValue.lat!, props.modelValue.lng!, props.modelValue.label);
  }

  if (searchEl.value) {
    autocomplete = new google.maps.places.Autocomplete(searchEl.value, {
      fields: ["geometry", "formatted_address", "name"],
      types: ["geocode"],
      ...(countryRestriction
        ? { componentRestrictions: { country: countryRestriction } }
        : {}),
    });
    autocomplete.bindTo("bounds", map);
    autocomplete.addListener("place_changed", () => {
      const place = autocomplete?.getPlace();
      const loc = place?.geometry?.location;
      if (!loc) return;
      setLocation(
        loc.lat(),
        loc.lng(),
        place?.formatted_address || place?.name || "",
      );
    });
  }

  map.addListener("click", (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    label.value = "";
    setLocation(e.latLng.lat(), e.latLng.lng(), "");
  });

  loading.value = false;
});

onBeforeUnmount(() => {
  marker?.setMap(null);
  circle?.setMap(null);
  markerLayer?.clear();
  if (autocomplete) google.maps.event.clearInstanceListeners(autocomplete);
  marker = null;
  circle = null;
  markerLayer = null;
  map = null;
  autocomplete = null;
});
</script>

<template>
  <div class="space-y-3">
    <Message v-if="status" severity="warn" :closable="true" @close="status = null">
      {{ status }}
    </Message>

    <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
      <input
        ref="searchEl"
        type="text"
        placeholder="Search an address or place"
        class="p-inputtext p-component w-full"
        autocomplete="off"
      />
      <Button
        label="Use my location"
        icon="pi pi-map-marker"
        outlined
        @click="useMyLocation"
      />
    </div>

    <div class="relative">
      <div
        ref="mapEl"
        class="h-72 w-full rounded-md border border-[color:var(--bs-border)]"
      ></div>
      <div
        v-if="loading"
        class="absolute inset-0 flex items-center justify-center rounded-md bg-white/70 text-sm text-[color:var(--bs-muted)]"
      >
        <i class="pi pi-spin pi-spinner mr-2"></i>Loading map…
      </div>
    </div>

    <div v-if="label" class="text-sm text-[color:var(--bs-muted)] truncate">
      <i class="pi pi-map-marker mr-1"></i>{{ label }}
    </div>

    <div>
      <label class="mb-1 block text-xs font-medium">
        Radius: {{ radiusKm }} km
      </label>
      <Slider
        v-model="radiusKm"
        :min="minRadius"
        :max="maxRadius"
        class="w-full"
      />
    </div>
  </div>
</template>
