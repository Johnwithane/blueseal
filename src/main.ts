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
import { reportClientError } from "./firebase/services/errorReporting";

const app = createApp(App);

// Global error visibility: route uncaught errors to the errorLogs collection so
// admins can see what users hit (AdminErrorsView), not just guess from reports.
// All three paths are best-effort — reportClientError swallows its own failures.
app.config.errorHandler = (err, _instance, info) => {
  // Preserve the console behaviour Vue would have had, then record it.
  console.error("[vue] unhandled error", err, info);
  const e = err instanceof Error ? err : undefined;
  reportClientError({
    source: "vue",
    message: e?.message ?? String(err),
    stack: e?.stack,
    context: info,
  });
};

window.addEventListener("error", (event) => {
  const e = event.error instanceof Error ? event.error : undefined;
  reportClientError({
    source: "window",
    message: event.message || e?.message || "Unknown error",
    stack: e?.stack,
    context: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const e = reason instanceof Error ? reason : undefined;
  reportClientError({
    source: "unhandledrejection",
    message: e?.message ?? (typeof reason === "string" ? reason : "Unhandled promise rejection"),
    stack: e?.stack,
  });
});

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
