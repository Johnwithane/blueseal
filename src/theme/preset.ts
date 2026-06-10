import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";

// Blue Seal duotone brand preset.
//
// Stock Aura renders severities (success/info/warn/danger on Tag, Message,
// Button, focus rings, selected rows) from its PRIMITIVE colour palettes —
// `green`, `blue`, `yellow`, `red`, etc. The new brand palette has no green or
// amber, so we override those primitives with the brand's *functional* ramps:
// every severity then inherits the brand instead of stock emerald/amber.
// `semantic.primary` maps the primary ramp to the brand navy (DarkBlue).
//
// All ramps mirror src/assets/main.css tokens — retune them together:
//   primary  → --bs-blue (#374C76, navy)      success → --bs-success (#3F7D5C)
//   info/blue → navy (200 = LightBlue #B3DCFF) warn    → --bs-warning (#C28A33)
//   danger/red → --bs-red (#B2373D)            secondary uses surface (grey) tokens
const PRIMARY = { 50: "#F2F5FA", 100: "#E1E8F2", 200: "#C3CFE2", 300: "#9CB0CE", 400: "#6D85B0", 500: "#46618F", 600: "#374C76", 700: "#2F4064", 800: "#2A3A5C", 900: "#243049", 950: "#161F30" };
const NAVY = { 50: "#F1F7FD", 100: "#DCEBFA", 200: "#B3DCFF", 300: "#8FC4F0", 400: "#5E97CB", 500: "#4470A0", 600: "#374C76", 700: "#2F4064", 800: "#2A3A5C", 900: "#243049", 950: "#161F30" };
const GREEN = { 50: "#F0F7F3", 100: "#DAEDE2", 200: "#B6DBC7", 300: "#87C2A4", 400: "#5BA37D", 500: "#468E68", 600: "#3F7D5C", 700: "#34664B", 800: "#2C523D", 900: "#254434", 950: "#12251C" };
const OCHRE = { 50: "#FBF6EC", 100: "#F5E9CE", 200: "#EBD29D", 300: "#DFB667", 400: "#D49E40", 500: "#C28A33", 600: "#A8762B", 700: "#875D23", 800: "#6E4C20", 900: "#5C401E", 950: "#34230F" };
const RED = { 50: "#FCF2F2", 100: "#F8DCDE", 200: "#F1BBBE", 300: "#E68E93", 400: "#D75F66", 500: "#C24750", 600: "#B2373D", 700: "#952D33", 800: "#7C282D", 900: "#68252A", 950: "#391012" };

export const BlueSealPreset = definePreset(Aura, {
  primitive: {
    // success — green/emerald/lime → brand functional green
    green: GREEN,
    emerald: GREEN,
    lime: GREEN,
    // danger/error — red/rose → brand red
    red: RED,
    rose: RED,
    // warning/pending — yellow/amber/orange → brand ochre
    yellow: OCHRE,
    amber: OCHRE,
    orange: OCHRE,
    // info — blue/sky/cyan/indigo → brand navy (200 = LightBlue accent)
    blue: NAVY,
    sky: NAVY,
    cyan: NAVY,
    indigo: NAVY,
  },
  semantic: {
    primary: PRIMARY,
  },
});
