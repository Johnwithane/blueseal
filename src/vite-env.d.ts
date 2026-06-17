/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/vue" />

// Build id baked in at compile time by vite's `define` (vite.config.ts), polled
// against /version.json to detect new deploys. See useAppUpdate().
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID: string;
  readonly VITE_USE_EMULATORS: string;
  readonly VITE_GOOGLE_MAPS_API_KEY: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_SENTRY_DSN: string;
  readonly VITE_APP_URL: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_DEFAULT_CURRENCY: string;
  readonly VITE_DEFAULT_REGION: string;
  readonly VITE_GOOGLE_BUSINESS_ENABLED: string;
  readonly VITE_SUPPLIES_ENABLED: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
