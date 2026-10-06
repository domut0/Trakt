import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGoogleToken,
  disconnectGoogleSession,
  getAccessToken,
  isPendingLogout,
  setGoogleTokenSource,
  warmGoogleAuth,
} from "../google-auth";
type CodeConfig = Parameters<
  NonNullable<Window["google"]>["accounts"]["oauth2"]["initCodeClient"] extends
    ((config: infer C) => unknown) | undefined
    ? (config: C) => unknown
    : never
>[0];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const ready = () => ({ status: "ready", state: "challenge", expiresAt: Date.now() + 600_000 });
const access = (token = "server-token") => ({
  status: "authenticated",
  accessToken: token,
  expiresIn: 3600,
});
let network: ReturnType<typeof vi.fn>;
let popup: ReturnType<typeof vi.fn<() => void>>;
let tokenPopup: ReturnType<typeof vi.fn<() => void>>;
let codeConfigs: CodeConfig[];
beforeEach(() => {
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
  setGoogleTokenSource(undefined);
  codeConfigs = [];
  popup = vi.fn();
  tokenPopup = vi.fn();
  window.google = {
    accounts: {
      oauth2: {
        initCodeClient: (config) => {
          codeConfigs.push(config);
          return { requestCode: popup };
        },
        initTokenClient: (config) => ({
          requestAccessToken: () => {
            tokenPopup();
            config.callback({ access_token: "picker-only-token", expires_in: 3600 });
          },
        }),
      },
    },
  };
  network = vi.fn(async (url: string) =>
    json(
      url.endsWith("/state")
        ? ready()
        : url.endsWith("/logout")
          ? { ok: true }
          : { status: "unauthenticated" },
    ),
  );
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  setGoogleTokenSource(undefined);
  delete window.google;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("persistent browser Google session", () => {
  it("silently recovers and deduplicates a cold start, then renews after token expiry", async () => {
    vi.useFakeTimers();
    network.mockImplementation(async () => json(access()));
    const results = await Promise.all([
      getAccessToken({ interactive: false }),
      getAccessToken({ interactive: false }),
      getAccessToken({ interactive: true }),
    ]);
    expect(results).toEqual(["server-token", "server-token", "server-token"]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Trakt-Client": "1", "Content-Type": "application/json" },
    });
    vi.setSystemTime(Date.now() + 3600_000);
    await expect(getAccessToken({ interactive: false })).resolves.toBe("server-token");
    expect(network).toHaveBeenCalledTimes(2);
    expect(popup).not.toHaveBeenCalled();
    expect(tokenPopup).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBeNull();
  });
  it.each([false, true])(
    "reports transient failure without opening a dialog (interactive=%s)",
    async (interactive) => {
      network.mockRejectedValue(new Error("offline"));
      await expect(getAccessToken({ interactive })).rejects.toThrow("offline");
      expect(popup).not.toHaveBeenCalled();
      expect(tokenPopup).not.toHaveBeenCalled();
    },
  );
  it("warms without popups and opens a prepared reconnect on the tap's synchronous stack", async () => {
    await warmGoogleAuth();
    expect(popup).not.toHaveBeenCalled();
    network.mockImplementation(async (url: string) =>
      json(url.endsWith("/exchange") ? access("connected") : ready()),
    );
    clearGoogleToken(); // reauthorize preserves the prepared state and server grant
    const result = getAccessToken({ interactive: true, reauthorize: true });
    expect(popup).toHaveBeenCalledTimes(1); // No awaited network request before opening.
    const config = codeConfigs[0];
    expect(config.scope).toBe("https://www.googleapis.com/auth/drive.file");
    expect(config.include_granted_scopes).toBe(false);
    config.callback({ code: "new-code", state: config.state });
    await expect(result).resolves.toBe("connected");
    expect(network.mock.calls.some(([url]) => url.endsWith("/logout"))).toBe(false);
    await expect(getAccessToken({ interactive: false })).resolves.toBe("connected");
  });
  it("refuses a mismatched OAuth callback before sending the code", async () => {
    await warmGoogleAuth();
    const result = getAccessToken({ interactive: true });
    const rejected = expect(result).rejects.toThrow("needs-consent");
    codeConfigs[0].callback({ code: "other", state: "wrong-state" });
    await rejected;
    expect(network.mock.calls.some(([url]) => url.endsWith("/exchange"))).toBe(false);
  });

  it("pauses old-account background recovery while a deliberate reconnect is pending", async () => {
    await warmGoogleAuth();
    const result = getAccessToken({ interactive: true, reauthorize: true });
    const requestsBefore = network.mock.calls.length;
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
    expect(network).toHaveBeenCalledTimes(requestsBefore);
    network.mockResolvedValue(json(access("chosen-account")));
    codeConfigs[0].callback({ code: "new-code", state: "challenge" });
    await expect(result).resolves.toBe("chosen-account");
    expect(isPendingLogout()).toBe(false);
    await expect(getAccessToken({ interactive: false })).resolves.toBe("chosen-account");
  });
  it("never downgrades to token mode when code client is missing on a configured server", async () => {
    delete window.google!.accounts.oauth2.initCodeClient;
    await warmGoogleAuth();
    await expect(getAccessToken({ interactive: true })).rejects.toThrow("script-blocked");
    expect(tokenPopup).not.toHaveBeenCalled();
  });
  it("keeps offline disconnect pending across a simulated page reload", async () => {
    network.mockRejectedValue(new Error("offline"));
    await expect(disconnectGoogleSession()).rejects.toThrow("offline");
    expect(isPendingLogout()).toBe(true);
    setGoogleTokenSource(undefined); // Clear module state; restore the persisted marker.
    localStorage.setItem("trakt_pending_logout", "1");
    network.mockResolvedValue(json(access("old-session")));
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
    expect(popup).not.toHaveBeenCalled();
  });
  it("ignores a refresh that finishes after disconnect", async () => {
    let finish!: (response: Response) => void;
    network.mockImplementation((url: string) =>
      url.endsWith("/logout")
        ? Promise.resolve(json({ ok: true }))
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const result = getAccessToken({ interactive: false });
    const rejected = expect(result).rejects.toThrow("needs-consent");
    await disconnectGoogleSession();
    finish(json(access("late-old-account")));
    await rejected;
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
  });
  it("rejects a late code callback after disconnect without exchanging it", async () => {
    await warmGoogleAuth();
    const result = getAccessToken({ interactive: true });
    const rejected = expect(result).rejects.toThrow("needs-consent");
    const config = codeConfigs[0];
    await disconnectGoogleSession();
    config.callback({ code: "late-code", state: config.state });
    await rejected;
    expect(network.mock.calls.some(([url]) => url.endsWith("/exchange"))).toBe(false);
  });
  it("keeps a completed exchange after disconnect from repopulating the access cache", async () => {
    await warmGoogleAuth();
    let finish!: (response: Response) => void;
    network.mockImplementation((url: string) =>
      url.endsWith("/exchange")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(json({ ok: true })),
    );
    const result = getAccessToken({ interactive: true });
    const rejected = expect(result).rejects.toThrow("needs-consent");
    codeConfigs[0].callback({ code: "code", state: "challenge" });
    await disconnectGoogleSession();
    finish(json(access("late-account")));
    await rejected;
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
  });
  it("bounds a stalled server request and allows a later retry", async () => {
    vi.useFakeTimers();
    network.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(getAccessToken({ interactive: false })).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(15_001);
    await result;
    network.mockResolvedValue(json(access()));
    await expect(getAccessToken({ interactive: false })).resolves.toBe("server-token");
  });
  it("does not mistake backend renewal for the browser session needed by Picker", async () => {
    network.mockImplementation(async (url: string) =>
      json(url.endsWith("/state") ? ready() : access()),
    );
    await warmGoogleAuth();
    await expect(getAccessToken({ interactive: true, freshSession: true })).resolves.toBe(
      "picker-only-token",
    );
    expect(tokenPopup).toHaveBeenCalledTimes(1);
    // Picker's account choice must not change the token used for ordinary sync.
    await expect(getAccessToken({ interactive: false })).resolves.toBe("server-token");
    expect(popup).not.toHaveBeenCalled();
  });
  it("retains the disconnect marker when consent fails, clearing it only on a completed exchange", async () => {
    await disconnectGoogleSession();
    await warmGoogleAuth();
    network.mockImplementation(async () => json({ error: "missing_refresh_token" }, 400));
    const result = getAccessToken({ interactive: true });
    codeConfigs[0].callback({ code: "code", state: "challenge" });
    await expect(result).rejects.toThrow("missing-refresh-token");
    expect(isPendingLogout()).toBe(true);
  });
});
