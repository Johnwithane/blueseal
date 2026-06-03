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

// Initialize auth before mounting so guards see a consistent state.
const authStore = useAuthStore();
authStore.init().then(() => {
  app.mount("#app");
});
