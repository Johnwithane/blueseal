import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";

// Blue Seal brand preset. PrimeVue shipped with stock Aura, whose primary is
// emerald green — so every default Button, focus ring, selected row and
// checkbox rendered green while the hand-built chrome used Blue Seal blue.
// This maps PrimeVue's `primary` semantic ramp onto the brand blue so all
// components inherit the brand from one place (see UI_UX_AUDIT.md, R1).
//
// The ramp is anchored on the existing brand tokens (main.css):
//   --bs-blue-light #9ec8e0 (≈300)  --bs-blue #3291c7 (500)  --bs-blue-dark #1e416b (900)
// PrimeVue uses 500 as the base and 600/700 for hover/active states.
// Anchored to the main.css --bs-blue ramp (300/500/900) — retune both together.
export const BlueSealPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "#f0f7fa",
      100: "#daeaf3",
      200: "#bddaea",
      300: "#9ec8e0",
      400: "#68add4",
      500: "#3291c7",
      600: "#2d7db0",
      700: "#286999",
      800: "#235582",
      900: "#1e416b",
      950: "#122740",
    },
  },
});
