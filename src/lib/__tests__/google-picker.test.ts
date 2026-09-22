import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preflightPicker, pickSharedSpreadsheet, setPickerFetch } from "../google-picker";
import { setGoogleTokenSource } from "../google-auth";

describe("Google Picker preflight", () => {
  afterEach(() => {
    setPickerFetch(undefined);
    setGoogleTokenSource(undefined);
    vi.restoreAllMocks();
  });

  it("200 carries on without throwing", async () => {
    setPickerFetch(
      async () => new Response(JSON.stringify({ kind: "drive#about" }), { status: 200 }),
    );
    await expect(preflightPicker("test-key", "test-token")).resolves.toBeUndefined();
  });

  it("400 with invalid key in body throws bad-api-key", async () => {
    setPickerFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "API key not valid. Please pass a valid API key.",
              status: "INVALID_ARGUMENT",
            },
          }),
          { status: 400 },
        ),
    );
    await expect(preflightPicker("test-key", "test-token")).rejects.toThrow("bad-api-key");
  });

  // The probe hits Drive, not the Picker, so a 403 here is not evidence about
  // the Picker at all -- and `drive.file` is narrow enough that a token which
  // may not call about.get is an ordinary, working state. Blocking on it would
  // lock out coaches whose setup is fine.
  it("403 falls through rather than blocking a coach whose setup is fine", async () => {
    setPickerFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: "Google Drive API has not been used in project before or it is disabled.",
              status: "PERMISSION_DENIED",
            },
          }),
          { status: 403 },
        ),
    );
    await expect(preflightPicker("test-key", "test-token")).resolves.toBeUndefined();
  });

  it("400 that is not about the key falls through", async () => {
    setPickerFetch(
      async () =>
        new Response(JSON.stringify({ error: { code: 400, message: "Invalid field selection" } }), {
          status: 400,
        }),
    );
    await expect(preflightPicker("test-key", "test-token")).resolves.toBeUndefined();
  });

  it("a rejected fetch falls through", async () => {
    setPickerFetch(async () => {
      throw new Error("Failed to fetch");
    });
    await expect(preflightPicker("test-key", "test-token")).resolves.toBeUndefined();
  });

  it("a timed out fetch falls through", async () => {
    setPickerFetch(
      () =>
        new Promise((resolve) => {
          // Never settles (or takes longer than preflight timeout)
          setTimeout(() => resolve(new Response("ok", { status: 200 })), 10_000);
        }),
    );
    // Use vi fake timers or short test
    vi.useFakeTimers();
    const promise = preflightPicker("test-key", "test-token");
    await vi.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("integrates into pickSharedSpreadsheet: 400 throws bad-api-key", async () => {
    setGoogleTokenSource(async () => "mock-token");
    setPickerFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "API developer key invalid" } }), {
          status: 400,
        }),
    );

    // Mock client ID and API key via env or globals if needed
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "123456789-test.apps.googleusercontent.com");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "test-api-key");

    await expect(pickSharedSpreadsheet()).rejects.toThrow("bad-api-key");
  });
});
