import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, setGoogleTokenSource } from "../google-auth";

describe("background Google sync never launches sign-in", () => {
  let requestAccessToken: ReturnType<typeof vi.fn>;
  let expiresIn = 3600;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    setGoogleTokenSource(undefined);
    expiresIn = 3600;
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            callback: (response: { access_token: string; expires_in: number }) => void;
          }) => {
            requestAccessToken = vi.fn(() =>
              config.callback({ access_token: "test-token", expires_in: expiresIn }),
            );
            return { requestAccessToken };
          },
        },
      },
    };
  });

  afterEach(() => {
    setGoogleTokenSource(undefined);
    delete (window as unknown as { google?: unknown }).google;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("fails without opening Google's token dialog on a cold start", async () => {
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
    expect(requestAccessToken).toBeUndefined();
  });

  it("continues background sync using an existing unexpired token", async () => {
    await expect(getAccessToken({ interactive: true })).resolves.toBe("test-token");
    requestAccessToken.mockClear();
    await expect(getAccessToken({ interactive: false })).resolves.toBe("test-token");
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it("does not open Google's token dialog when the cached token expires", async () => {
    expiresIn = 120;
    await getAccessToken({ interactive: true });
    requestAccessToken.mockClear();
    vi.setSystemTime(new Date("2026-10-02T12:03:00Z"));
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it("pauses without a dialog inside the renewal safety margin", async () => {
    await getAccessToken({ interactive: true });
    requestAccessToken.mockClear();
    vi.setSystemTime(new Date("2026-10-02T12:59:10Z"));
    await expect(getAccessToken({ interactive: false })).rejects.toThrow("needs-consent");
    expect(requestAccessToken).not.toHaveBeenCalled();
  });
});
