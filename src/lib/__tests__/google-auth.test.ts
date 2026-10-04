import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, setGoogleTokenSource, warmGoogleAuth } from "../google-auth";

/**
 * A stand-in for Google Identity Services.
 *
 * The real one is a script tag away, so everything here turns on what its two
 * callbacks are handed and when: a token, a decline, or a window the browser
 * would not open.
 */
function installGis() {
  const state = {
    inits: 0,
    requests: 0,
    /** `prompt: ""` is a silent renewal; undefined is a deliberate tap. */
    prompts: [] as (string | undefined)[],
    answer: undefined as ((cb: Callbacks, overrides?: { prompt?: string }) => void) | undefined,
  };

  interface Callbacks {
    callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void;
    error_callback?: (e: { type?: string }) => void;
  }

  // Each client keeps its own callbacks, as the real one does. A single shared
  // slot here would hide the very collision these tests are about: the silent
  // client and the interactive one answering for each other.
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: Callbacks) => {
          state.inits += 1;
          return {
            requestAccessToken: (overrides?: { prompt?: string }) => {
              state.requests += 1;
              state.prompts.push(overrides?.prompt);
              state.answer?.(config, overrides);
            },
          };
        },
      },
    },
  };

  return state;
}

describe("google sign-in", () => {
  let gis: ReturnType<typeof installGis>;

  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    // Also clears the cached token, the token client and any in-flight request.
    setGoogleTokenSource(undefined);
    gis = installGis();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setGoogleTokenSource(undefined);
    delete (window as unknown as { google?: unknown }).google;
  });

  it("builds the token client before the tap, and reuses it on the tap", async () => {
    warmGoogleAuth();
    await Promise.resolve();
    expect(gis.inits).toBe(1);

    gis.answer = (cb) => cb.callback({ access_token: "tok", expires_in: 3600 });
    await expect(getAccessToken({ interactive: true })).resolves.toBe("tok");

    // The whole point: the tap opened a window, it did not build a client.
    expect(gis.inits).toBe(1);
  });

  it("retries once when the browser refuses to open the window", async () => {
    // A blocked popup is what a slow script load produced: the activation from
    // the tap was gone by the time there was anything to open. The retry runs
    // with everything already in memory, so it gets through.
    gis.answer = (cb) => {
      if (gis.requests === 1) cb.error_callback?.({ type: "popup_failed_to_open" });
      else cb.callback({ access_token: "tok", expires_in: 3600 });
    };

    await expect(getAccessToken({ interactive: true })).resolves.toBe("tok");
    expect(gis.requests).toBe(2);
  });

  it("does not retry a decline, because asking twice is arguing", async () => {
    gis.answer = (cb) => cb.error_callback?.({ type: "popup_closed" });

    await expect(getAccessToken({ interactive: true })).rejects.toThrow("needs-consent");
    expect(gis.requests).toBe(1);
  });

  it("reports a blocked window as its own failure when the retry fails too", async () => {
    gis.answer = (cb) => cb.error_callback?.({ type: "popup_failed_to_open" });

    await expect(getAccessToken({ interactive: true })).rejects.toThrow("popup-blocked");
    expect(gis.requests).toBe(2);
  });

  it("never requests a fresh token from background sync", async () => {
    gis.answer = (cb) => cb.error_callback?.({ type: "popup_failed_to_open" });

    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
    expect(gis.requests).toBe(0);
    expect(gis.inits).toBe(0);
  });

  it("gives two overlapping interactive callers the one request", async () => {
    gis.answer = (cb) => cb.callback({ access_token: "tok", expires_in: 3600 });

    const [a, b] = await Promise.all([
      getAccessToken({ interactive: true }),
      getAccessToken({ interactive: true }),
    ]);

    expect([a, b]).toEqual(["tok", "tok"]);
    expect(gis.requests).toBe(1);
  });

  it("serves the second caller from cache once one has a token", async () => {
    gis.answer = (cb) => cb.callback({ access_token: "tok", expires_in: 3600 });
    await getAccessToken({ interactive: true });
    await getAccessToken({ interactive: false });
    expect(gis.requests).toBe(1);
  });

  /**
   * The bug behind "adding a client stops working after a day".
   *
   * Foregrounding starts background sync. That request must fail cache-only
   * while the deliberate tap gets its own interactive request.
   */
  it("does not let a background renewal answer a deliberate tap", async () => {
    gis.answer = (cb) => {
      cb.callback({ access_token: "tok", expires_in: 3600 });
    };

    const silent = getAccessToken({ interactive: false });
    const rejected = expect(silent).rejects.toThrow("needs-consent");
    await expect(getAccessToken({ interactive: true })).resolves.toBe("tok");

    expect(gis.requests).toBe(1);
    expect(gis.prompts).toEqual([undefined]);
    await rejected;
  });

  /**
   * The other half of the same failure, and the reason it needed site data
   * cleared rather than a reload: an installed PWA is never reloaded.
   *
   * The deadline used to sit outside the request, so a GIS call that dropped
   * both callbacks rejected the CALLER and left the request itself in flight
   * forever. Every later request was then handed that dead promise.
   */
  it("times out a dropped callback without wedging every request after it", async () => {
    vi.useFakeTimers();
    try {
      gis.answer = () => {
        // GIS drops both callbacks, as it does when its iframe is blocked.
      };

      const first = getAccessToken({ interactive: true });
      const timedOut = expect(first).rejects.toThrow("timeout");
      await vi.advanceTimersByTimeAsync(120_000);
      await timedOut;

      gis.answer = (cb) => cb.callback({ access_token: "tok", expires_in: 3600 });
      await expect(getAccessToken({ interactive: true })).resolves.toBe("tok");
      expect(gis.requests).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a timed-out dialog's late response while a newer sign-in is pending", async () => {
    vi.useFakeTimers();
    try {
      let answerOld: (() => void) | undefined;
      gis.answer = (cb) => {
        answerOld = () => cb.callback({ access_token: "old-account", expires_in: 3600 });
      };
      const first = expect(getAccessToken({ interactive: true })).rejects.toThrow("timeout");
      await vi.advanceTimersByTimeAsync(120_000);
      await first;

      let answerNew: (() => void) | undefined;
      gis.answer = (cb) => {
        answerNew = () => cb.callback({ access_token: "new-account", expires_in: 3600 });
      };
      const next = getAccessToken({ interactive: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(gis.requests).toBe(2);
      answerOld?.();
      await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
      answerNew?.();
      await expect(next).resolves.toBe("new-account");
      await expect(getAccessToken({ interactive: false })).resolves.toBe("new-account");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The Picker does not run on the token alone: it draws a docs.google.com
   * iframe that authenticates with the user's Google cookies, and on WebKit
   * those are partitioned away from it once the storage-access grant lapses.
   * Re-minting the token re-opens accounts.google.com first-party, which is
   * what puts them back -- so a credential too old to vouch for that session
   * is refused even though it has not expired.
   */
  it("mints a new token for the Picker once the session behind it may have lapsed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      gis.answer = (cb) => cb.callback({ access_token: "first", expires_in: 3600 });
      await expect(getAccessToken({ interactive: true })).resolves.toBe("first");

      // Four minutes on. The session is plainly still live, and a second
      // window here would be noise in front of a coach who just signed in.
      vi.setSystemTime(4 * 60_000);
      await expect(getAccessToken({ interactive: true, freshSession: true })).resolves.toBe(
        "first",
      );
      expect(gis.requests).toBe(1);

      // Ten minutes on. The token is still valid for another fifty; the
      // cookies are the part nothing here can see.
      vi.setSystemTime(10 * 60_000);
      gis.answer = (cb) => cb.callback({ access_token: "second", expires_in: 3600 });
      await expect(getAccessToken({ interactive: true, freshSession: true })).resolves.toBe(
        "second",
      );
      expect(gis.requests).toBe(2);

      // Sync is untouched by any of this: it carries the token in a header and
      // has no iframe to keep alive.
      await expect(getAccessToken({ interactive: false })).resolves.toBe("second");
      expect(gis.requests).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
