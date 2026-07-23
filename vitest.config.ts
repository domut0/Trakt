import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that file wraps
// @lovable.dev/vite-tanstack-config, whose defineConfig type does not accept
// a `test` key. Vitest picks this file up automatically (it merges root-level
// vite.config.ts / vitest.config.ts by default), so this is the only config
// vitest needs.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
