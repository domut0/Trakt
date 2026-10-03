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
    answer: undefined as ((cb: Callbacks) => void) | undefined,
  };

  interface Callbacks {
    callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void;
    error_callback?: (e: { type?: string }) => void;
  }

  let callbacks: Callbacks | undefined;

  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: Callbacks) => {
          state.inits += 1;
          callbacks = config;
          return {
            requestAccessToken: () => {
              state.requests += 1;
              if (callbacks && state.answer) state.answer(callbacks);
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
});
