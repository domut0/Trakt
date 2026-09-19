import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorForStatus } from "../sync-client-google";
import { clearGoogleToken, getAccessToken, setGoogleTokenSource } from "../google-auth";

/**
 * The parts of the Sheets transport that can be proven without a Google
 * account: how a status code maps onto what the user can do, and the token
 * cache.
 *
 * The rest -- that the consent screen shows only drive.file, that a created
 * spreadsheet comes back with its tabs -- is answered by
 * `scripts/google-spike.html`, because it is a fact about live Google
 * behaviour and no unit test can establish it.
 */

afterEach(() => {
  setGoogleTokenSource(undefined);
  clearGoogleToken();
  vi.useRealTimers();
});

describe("errorForStatus", () => {
  it.each([
    // Retrying cannot help: only the user can clear these.
    [401, "needs-consent"],
    [403, "bad-secret"],
    [404, "unreadable"],
    // Genuinely transient.
    [429, "busy"],
    [500, "busy"],
    [503, "busy"],
  ])("maps %i to %s", (status, expected) => {
    expect(errorForStatus(status)).toBe(expected);
  });

  it("does not call a revoked grant transient, which would retry forever", () => {
    expect(errorForStatus(401)).not.toBe("busy");
    expect(errorForStatus(403)).not.toBe("busy");
  });
});

describe("the token source seam", () => {
  beforeEach(() => {
    clearGoogleToken();
  });

  it("routes through an installed source, so tests never reach Google", async () => {
    setGoogleTokenSource(() => Promise.resolve("fake-token"));
    expect(await getAccessToken({ interactive: false })).toBe("fake-token");
  });

  it("passes the interactive flag through, since it decides whether a popup can appear", async () => {
    const seen: boolean[] = [];
    setGoogleTokenSource((interactive) => {
      seen.push(interactive);
      return Promise.resolve("t");
    });
    await getAccessToken({ interactive: false });
    await getAccessToken({ interactive: true });
    expect(seen).toEqual([false, true]);
  });

  it("surfaces needs-consent as a rejection the caller can branch on", async () => {
    setGoogleTokenSource(() => Promise.reject(new Error("needs-consent")));
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
  });

  it("fails with no-client-id when the build carries no OAuth client", async () => {
    // Stubbed rather than relying on the ambient env: whether .env.local exists
    // is a property of the machine running the tests, and a test that passes or
    // hangs depending on that is worse than no test.
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    setGoogleTokenSource(undefined);
    await expect(getAccessToken({ interactive: false })).rejects.toThrow(/no-client-id/);
    vi.unstubAllEnvs();
  });

  it("gives up on a Google script that never loads, instead of hanging", async () => {
    // The failure this guards against is not a slow sync, it is a wedged one:
    // syncNow holds a single-flight flag for the length of a cycle, so a promise
    // that never settles stops the app syncing for the rest of the session with
    // the UI still reading "syncing".
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test.apps.googleusercontent.com");
    setGoogleTokenSource(undefined);
    vi.useFakeTimers();

    const pending = getAccessToken({ interactive: false });
    const assertion = expect(pending).rejects.toThrow(/script-blocked/);
    // jsdom appends the script tag and neither event ever fires, which is
    // exactly the real-world case of a blocked or stalled third-party script.
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;

    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
});
