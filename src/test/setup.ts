import { beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { setSyncFetch } from "../lib/sync-client";

// Sheet sync is the app's only network call, and nothing in this suite should
// ever make a real one. Installing a throwing default means a test that forgets
// to provide its own fetch fails loudly here, rather than quietly reaching
// Google and passing or hanging depending on the network.
//
// Reset per test so one test's stub cannot leak into the next.
beforeEach(() => {
  setSyncFetch(() => {
    throw new Error("Unstubbed network call. Provide a fetch with setSyncFetch() in this test.");
  });
});
