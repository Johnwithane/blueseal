// Dedicated vitest config for Firestore rules tests. Separate from the main
// vitest.config.ts because rules tests need the Node environment (not
// happy-dom), talk to a live Firestore emulator on localhost:8080, and
// share state across specs that can't be parallelised.
//
// Run via `npm run test:rules` which wraps this in `firebase emulators:exec`
// so the emulator starts + stops around the test command.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    environment: "node",
    globals: true,
    // All specs share the single Firestore emulator instance and call
    // `clearFirestore()` in beforeEach — running spec files in parallel
    // would let one spec wipe data another is mid-test on.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
