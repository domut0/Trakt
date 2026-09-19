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
    // No source installed and no VITE_GOOGLE_CLIENT_ID in the test env, which
    // is the state of every build until the console setup is done.
    setGoogleTokenSource(undefined);
    await expect(getAccessToken({ interactive: false })).rejects.toThrow(/no-client-id/);
  });
});
