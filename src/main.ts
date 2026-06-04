import { createApp } from "vue";
import { createPinia } from "pinia";
import { createHead } from "@unhead/vue/client";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import { BlueSealPreset } from "./theme/preset";
import "primeicons/primeicons.css";
import "./assets/main.css";

import App from "./App.vue";
import router from "./router";
import { useAuthStore } from "./stores/auth";

const app = createApp(App);

app.use(createPinia());
app.use(createHead());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: BlueSealPreset,
    options: { darkModeSelector: ".bs-dark" },
  },
});
app.use(ToastService);
app.use(ConfirmationService);

// Fade out and remove the boot splash (see index.html) once the app is on
// screen — or if auth init fails, so the splash never stays stuck covering the
// page (the baked crawler markup shows through as a fallback in that case).
function dismissBootSplash() {
  const el = document.getElementById("bs-splash");
  if (!el) return;
  el.classList.add("bs-splash--out");
  setTimeout(() => el.remove(), 300);
}

// Initialize auth before mounting so guards see a consistent state.
const authStore = useAuthStore();
authStore
  .init()
  .then(() => {
    app.mount("#app");
  })
  .catch((err) => {
    console.error("[main] auth init failed before mount", err);
  })
  .finally(dismissBootSplash);
