import { beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// Sheet sync is the app's only network call, and nothing in this suite should
// ever make a real one. Installing a throwing default means a test that forgets
// to provide its own fetch fails loudly here, rather than quietly reaching
// Google and passing or hanging depending on the network.
//
// Reset per test so one test's stub cannot leak into the next.
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error('Unstubbed network call. Stub fetch with vi.stubGlobal("fetch", ...).');
  });
});
