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
}

const props = withDefaults(
  defineProps<{
    modelValue: LocationValue;
    minRadius?: number;
    maxRadius?: number;
    country?: string;
    // Optional Airbnb-style result pins drawn on the same map.
    markers?: AvatarMarkerData[];
  }>(),
  {
    minRadius: 1,
    maxRadius: 200,
    country: "",
    markers: () => [],
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
const radiusKm = ref(props.modelValue.radiusKm || 50);

let map: google.maps.Map | null = null;
let marker: google.maps.Marker | null = null;
let circle: google.maps.Circle | null = null;
let autocomplete: google.maps.places.Autocomplete | null = null;
let markerLayer: AvatarMarkerLayer | null = null;

function emitChange(lat: number | null, lng: number | null, newLabel?: string) {
  emit("update:modelValue", {
    lat,
    lng,
    radiusKm: radiusKm.value,
    label: (newLabel ?? label.value) || undefined,
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
    // Plain scroll wheel / one-finger drag zooms directly — no "use ctrl +
    // scroll" gate. The map sits in a short fixed-height box, not a long
    // scrolling column, so hijacking the wheel here doesn't trap the page.
    // "cooperative" so a one-finger vertical drag over the map scrolls the
    // page (the picker sits mid-form with fields below it) — two fingers or a
    // tap engages map pan/zoom. "greedy" trapped page scroll on mobile.
    gestureHandling: "cooperative",
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
