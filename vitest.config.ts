import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so the app's build plugins (tanstackStart,
// nitro, PWA) don't load during unit tests. Vitest picks this file up
// automatically, so it's the only config the test run needs.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
