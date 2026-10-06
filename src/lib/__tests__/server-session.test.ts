import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealData } from "iron-session";
import {
  getServerConfig,
  handleSessionRequest,
  parseCookies,
  sealSession,
  unsealSession,
} from "../server-session";
const env = {
  GOOGLE_CLIENT_SECRET: "test-only-secret",
  GOOGLE_SESSION_PASSWORD: "test-only-password-at-least-32-characters",
  VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
};
const origin = "https://trakt.example";
let google: ReturnType<typeof vi.fn>;
const post = (path = "", cookie = "", body: unknown = {}) =>
  new Request(`${origin}/api/session${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Trakt-Client": "1", cookie },
    body: JSON.stringify(body),
  });
const run = (request: Request, config = env) =>
  handleSessionRequest(request, config).then((result) => result!);
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const session = () =>
  sealSession(
    { refreshToken: "refresh-private", clientId: env.VITE_GOOGLE_CLIENT_ID },
    env.GOOGLE_SESSION_PASSWORD,
  );
const cookieFrom = (result: Response, name: string) =>
  result.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))!
    .split(";")[0];
async function challenge() {
  const result = await run(post("/state"));
  const body = await result.json();
  return { state: body.state as string, cookie: cookieFrom(result, "trakt_oauth_state") };
}
beforeEach(() => {
  google = vi.fn();
  vi.stubGlobal("fetch", google);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("persistent Google server session", () => {
  it("recovers from the encrypted browser cookie across server instances and renews its lifetime", async () => {
    const { state, cookie } = await challenge();
    google.mockResolvedValueOnce(
      response({
        access_token: "access-first",
        expires_in: 3600,
        refresh_token: "refresh-private",
        scope: "https://www.googleapis.com/auth/drive.file",
      }),
    );
    const exchange = await run(post("/exchange", cookie, { code: "code-one", state }));
    expect(exchange.status).toBe(200);
    expect(await exchange.json()).toEqual({
      status: "authenticated",
      accessToken: "access-first",
      expiresIn: 3600,
    });
    const sealedCookie = cookieFrom(exchange, "trakt_session");
    expect(sealedCookie).not.toContain("refresh-private");
    expect(exchange.headers.get("set-cookie")).toContain("HttpOnly");
    expect(exchange.headers.get("set-cookie")).toContain("Secure");
    expect(exchange.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(exchange.headers.get("set-cookie")).not.toContain("Domain=");
    const exchangeBody = google.mock.calls[0][1].body as URLSearchParams;
    expect(exchangeBody.get("redirect_uri")).toBe(origin);
    expect(exchangeBody.get("client_secret")).toBe(env.GOOGLE_CLIENT_SECRET);
    expect(google.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600_000);
    google.mockResolvedValueOnce(response({ access_token: "access-renewed", expires_in: 3600 }));
    const refreshed = await run(post("", sealedCookie));
    expect(await refreshed.json()).toEqual({
      status: "authenticated",
      accessToken: "access-renewed",
      expiresIn: 3600,
    });
    expect(refreshed.headers.get("cache-control")).toContain("no-store");
    expect(refreshed.headers.get("set-cookie")).toContain("Max-Age=7776000");
    const refreshBody = google.mock.calls[1][1].body as URLSearchParams;
    expect(refreshBody.get("refresh_token")).toBe("refresh-private");
    expect(refreshBody.get("grant_type")).toBe("refresh_token");
  });
  it.each(["", "/state", "/exchange", "/logout"])(
    "rejects GET and cross-origin requests for %s",
    async (path) => {
      expect((await run(new Request(`${origin}/api/session${path}`))).status).toBe(405);
      for (const foreign of [
        "https://evil.example",
        "http://trakt.example",
        "https://trakt.example:444",
        "null",
        "",
      ]) {
        const request = post(path);
        request.headers.set("Origin", foreign);
        request.headers.set("Host", "trakt.example");
        request.headers.set("X-Forwarded-Host", "evil.example");
        expect((await run(request)).status).toBe(403);
      }
      const noHeader = post(path);
      noHeader.headers.delete("x-trakt-client");
      expect((await run(noHeader)).status).toBe(400);
      const form = post(path);
      form.headers.set("content-type", "text/plain");
      expect((await run(form)).status).toBe(400);
      expect(google).not.toHaveBeenCalled();
    },
  );
  it("distinguishes intentional local fallback from broken production configuration", async () => {
    expect(await (await handleSessionRequest(post(), {}))!.json()).toEqual({
      status: "unconfigured",
    });
    expect((await run(post(), { ...env, GOOGLE_SESSION_PASSWORD: "short" })).status).toBe(503);
    expect(getServerConfig({ ...env, GOOGLE_CLIENT_ID: "different-client" })).toBeUndefined();
    expect(await (await run(post())).json()).toEqual({ status: "unauthenticated" });
  });
  it.each(["malformed", "%not-valid", ""])(
    "handles malformed or absent cookies (%s) without calling Google",
    async (value) => {
      const result = await run(post("", `trakt_session=${value}`));
      expect(await result.json()).toEqual({ status: "unauthenticated" });
      expect(google).not.toHaveBeenCalled();
      expect(Object.getPrototypeOf(parseCookies("__proto__=bad"))).toBeNull();
    },
  );
  it("rejects expired, tampered, and different-client sessions", async () => {
    const sealed = await session();
    expect(await unsealSession(sealed, env.GOOGLE_SESSION_PASSWORD)).toEqual({
      refreshToken: "refresh-private",
      clientId: env.VITE_GOOGLE_CLIENT_ID,
    });
    const other = await sealSession(
      { refreshToken: "other", clientId: "other-client" },
      env.GOOGLE_SESSION_PASSWORD,
    );
    for (const value of [sealed.slice(0, 40) + "X" + sealed.slice(41), other])
      expect(await (await run(post("", `trakt_session=${value}`))).json()).toEqual({
        status: "unauthenticated",
      });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 91 * 86400_000);
    expect(await (await run(post("", `trakt_session=${sealed}`))).json()).toEqual({
      status: "unauthenticated",
    });
    expect(google).not.toHaveBeenCalled();
  });
  it.each([400, 401, 429, 503])(
    "preserves the grant on configuration/upstream errors (%s)",
    async (status) => {
      google.mockResolvedValue(response({ error: "invalid_client" }, status));
      const result = await run(post("", `trakt_session=${await session()}`));
      expect(result.status).toBe(503);
      expect(result.headers.get("set-cookie")).toBeNull();
    },
  );
  it("clears only a grant Google explicitly revoked", async () => {
    google.mockResolvedValue(response({ error: "invalid_grant" }, 400));
    const result = await run(post("", `trakt_session=${await session()}`));
    expect(await result.json()).toEqual({ status: "unauthenticated" });
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("keeps credentials on transport errors and malformed Google responses", async () => {
    google.mockRejectedValueOnce(new Error("offline"));
    google.mockResolvedValueOnce(
      response({ access_token: "x", expires_in: 3600, scope: "unrelated-scope" }),
    );
    for (let i = 0; i < 2; i++) {
      const result = await run(post("", `trakt_session=${await session()}`));
      expect(result.status).toBeGreaterThanOrEqual(500);
      expect(result.headers.get("set-cookie")).toBeNull();
    }
  });
  it("never joins a new account's access token to an old account's refresh credential", async () => {
    const { state, cookie } = await challenge();
    google.mockResolvedValue(response({ access_token: "new-account", expires_in: 3600 }));
    const result = await run(
      post("/exchange", `${cookie}; trakt_session=${await session()}`, { code: "new-code", state }),
    );
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: "missing_refresh_token" });
    expect(result.headers.get("set-cookie")).not.toContain("trakt_session=");
  });
  it("binds authorization to an expiring encrypted challenge and reuses it across warm-ups", async () => {
    const { state, cookie } = await challenge();
    expect(cookie).not.toContain(state);
    const again = await run(post("/state", cookie));
    expect((await again.json()).state).toBe(state);
    expect(again.headers.get("set-cookie")).toBeNull();
    expect((await run(post("/exchange", cookie, { code: "x", state: "different" }))).status).toBe(
      400,
    );
    expect((await run(post("/exchange", "", { code: "x", state }))).status).toBe(400);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 601_000);
    expect((await run(post("/exchange", cookie, { code: "x", state }))).status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });
  it("rejects oversized and malformed exchange payloads before reaching Google", async () => {
    expect((await run(post("/exchange", "", { code: "x".repeat(9000) }))).status).toBe(413);
    for (const body of [null, [], { code: {}, state: {} }])
      expect((await run(post("/exchange", "", body))).status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });
  it("expires both browser cookies without revoking Google access on other devices", async () => {
    const result = await run(post("/logout"));
    expect(await result.json()).toEqual({ ok: true });
    expect(result.headers.getSetCookie()).toHaveLength(2);
    expect(result.headers.getSetCookie().every((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(google).not.toHaveBeenCalled();
  });
  it("does not accept a session cookie as an OAuth challenge", async () => {
    const sealed = await sealData(
      { purpose: "google-session", state: "a".repeat(64), expiresAt: Date.now() + 600_000 },
      { password: env.GOOGLE_SESSION_PASSWORD, ttl: 600 },
    );
    expect(
      (
        await run(
          post("/exchange", `trakt_oauth_state=${sealed}`, { code: "x", state: "a".repeat(64) }),
        )
      ).status,
    ).toBe(400);
  });
});
