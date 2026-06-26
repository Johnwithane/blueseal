import { defineConfig, type Plugin } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// vite-plugin-pwa supplies `virtual:pwa-register/vue` at build time; it isn't in
// the test build, so stub it here (a no-op register) for any module that imports
// it — e.g. useAppUpdate. Without this, Vite fails to resolve the import before
// vi.mock can run.
function pwaRegisterStub(): Plugin {
  const id = "virtual:pwa-register/vue";
  return {
    name: "stub-pwa-register",
    resolveId: (source) => (source === id ? "\0" + id : undefined),
    load: (resolved) =>
      resolved === "\0" + id
        ? "export const useRegisterSW = () => ({ updateServiceWorker: () => {} });"
        : undefined,
  };
}

export default defineConfig({
  plugins: [vue(), pwaRegisterStub()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    // Rules tests live in tests/rules/ and run against the Firestore
    // emulator via the dedicated `npm run test:rules` script + its own
    // config. They'd crash here (no emulator) and they don't belong in
    // the unit-test sweep anyway.
    // e2e/ holds Playwright specs — they use Playwright's runner, not vitest.
    exclude: ["node_modules/**", "dist/**", "tests/rules/**", "functions/**", "e2e/**"],
    // Stub the VITE_FIREBASE_* env vars so modules that import
    // @/firebase/config can initialize at module-load time without
    // pulling real credentials into the test runner. The values are
    // never used (no test hits the network) but Firebase Auth's init
    // throws on missing apiKey rather than deferring.
    env: {
      VITE_FIREBASE_API_KEY: "test-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "test.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "test-project",
      VITE_FIREBASE_STORAGE_BUCKET: "test.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "0",
      VITE_FIREBASE_APP_ID: "0:0:web:0",
    },
  },
});
