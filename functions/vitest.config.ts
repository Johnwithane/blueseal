import { defineConfig } from "vitest/config";

// Unit tests for the Cloud Functions callables (the "API"). They run the v2
// onCall handlers directly via `.run()` with the Firestore/notify/chat seams
// mocked — no emulator, no network. Firestore rules are covered separately by
// the root `npm run test:rules` (emulator). E2E lives in ../e2e.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true,
  },
});
