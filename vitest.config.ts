import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so the app's build plugins (tanstackStart,
// nitro, PWA) don't load during unit tests. Vitest picks this file up
// automatically, so it's the only config the test run needs.
export default defineConfig({
  // The app imports itself as "@/...", which tsconfig maps but vitest does not
  // infer. Without this a test that reaches a component using it fails to
  // resolve rather than failing an assertion.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
