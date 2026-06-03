import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
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
