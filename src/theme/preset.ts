import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";

// Blue Seal brand preset. PrimeVue shipped with stock Aura, whose primary is
// emerald green — so every default Button, focus ring, selected row and
// checkbox rendered green while the hand-built chrome used Blue Seal blue.
// This maps PrimeVue's `primary` semantic ramp onto the brand blue so all
// components inherit the brand from one place (see UI_UX_AUDIT.md, R1).
//
// The ramp is anchored on the existing brand tokens (main.css):
//   --bs-blue-light #a0d6f1 (≈300)  --bs-blue #49a1d3 (500)  --bs-blue-dark #1d406a (900)
// PrimeVue uses 500 as the base and 600/700 for hover/active states.
export const BlueSealPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "#f0f8fd",
      100: "#d8edf9",
      200: "#b4dcf2",
      300: "#a0d6f1",
      400: "#6fbbe2",
      500: "#49a1d3",
      600: "#3a86b8",
      700: "#2f6a92",
      800: "#285471",
      900: "#1d406a",
      950: "#102844",
    },
  },
});
