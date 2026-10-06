import { sealData, unsealData } from "iron-session";

// Server entry only. No app data, client stores, or browser imports belong here.
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SESSION_COOKIE = "trakt_session";
const STATE_COOKIE = "trakt_oauth_state";
const SESSION_TTL = 90 * 24 * 60 * 60;
const STATE_TTL = 600;
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 8192;

type Env = Record<string, string | undefined>;
export interface ServerConfig {
  clientId: string;
  clientSecret: string;
  password: string;
}
export function getServerConfig(env: Env = process.env): ServerConfig | undefined {
  const clientId = env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID;
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_ID !== env.VITE_GOOGLE_CLIENT_ID) return;
  if (
    !clientId ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_SESSION_PASSWORD ||
    env.GOOGLE_SESSION_PASSWORD.length < 32
  )
    return;
  return {
    clientId,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    password: env.GOOGLE_SESSION_PASSWORD,
  };
}

export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at < 1) continue;
    try {
      result[pair.slice(0, at).trim()] = decodeURIComponent(pair.slice(at + 1).trim());
    } catch {
      /* A malformed cookie is an absent session, never an SSR error. */
    }
  }
  return result;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; secure?: boolean } = {},
): string {
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/api/session; HttpOnly; SameSite=Lax; Max-Age=${options.maxAge ?? 0}${options.secure ? "; Secure" : ""}`;
  if (cookie.length > 3800) throw new Error("cookie_too_large");
  return cookie;
}

interface SessionPayload {
  refreshToken: string;
  clientId: string;
}
export async function sealSession(payload: SessionPayload, password: string): Promise<string> {
  return sealData(
    { ...payload, purpose: "google-session", expiresAt: Date.now() + SESSION_TTL * 1000 },
    { password, ttl: SESSION_TTL },
  );
}
export async function unsealSession(
  sealed: string,
  password: string,
): Promise<SessionPayload | undefined> {
  try {
    const data = await unsealData<SessionPayload & { purpose: string; expiresAt: number }>(sealed, {
      password,
      ttl: SESSION_TTL,
    });
    if (
      data.purpose === "google-session" &&
      data.expiresAt! > Date.now() &&
      validString(data.refreshToken, 2048) &&
      validString(data.clientId, 256)
    ) {
      return { refreshToken: data.refreshToken!, clientId: data.clientId! };
    }
  } catch {
    /* Tampered/expired credentials require a new deliberate connection. */
  }
}

interface Challenge {
  purpose: string;
  state: string;
  expiresAt: number;
}
async function readChallenge(
  sealed: string | undefined,
  password: string,
): Promise<Challenge | undefined> {
  if (!sealed || sealed.length > 3800) return;
  try {
    const data = await unsealData<Challenge>(sealed, { password, ttl: STATE_TTL });
    if (
      data.purpose === "oauth-state" &&
      typeof data.state === "string" &&
      /^[a-f0-9]{64}$/.test(data.state) &&
      data.expiresAt! > Date.now()
    )
      return data as Challenge;
  } catch {
    /* Absent or expired challenge. */
  }
}
function validString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  result.set("Cache-Control", "no-store, private");
  result.set("Pragma", "no-cache");
  result.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers: result });
}

// Bound streams as well as Content-Length; also limit the time spent waiting for a body.
async function boundedJson(source: Request | Response): Promise<Record<string, unknown>> {
  const reader = source.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BODY_BYTES) throw new Error("payload_too_large");
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("invalid_json");
        return data as Record<string, unknown>;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

async function googleTokens(parameters: Record<string, string>, config: ServerConfig) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...parameters,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      signal: controller.signal,
    });
    const body = await boundedJson(response);
    return { ok: response.ok, body };
  } finally {
    clearTimeout(timer);
  }
}
function accessResult(body: Record<string, unknown>) {
  const scope = body.scope;
  if (
    scope !== undefined &&
    (typeof scope !== "string" || !scope.split(" ").includes(DRIVE_FILE_SCOPE))
  )
    return;
  if (
    !validString(body.access_token, 4096) ||
    typeof body.expires_in !== "number" ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 60 ||
    body.expires_in > 86400
  )
    return;
  return { status: "authenticated", accessToken: body.access_token, expiresIn: body.expires_in };
}

export async function handleSessionRequest(
  request: Request,
  env: Env = process.env,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/session" && !url.pathname.startsWith("/api/session/")) return;
  const endpoint = url.pathname;
  if (
    ![
      "/api/session",
      "/api/session/state",
      "/api/session/exchange",
      "/api/session/logout",
    ].includes(endpoint)
  )
    return json({ error: "not_found" }, 404);
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  // Compare the full origin, including protocol and port. Never trust a caller's
  // forwarded-host header to choose Google's redirect URI or bypass this check.
  if (request.headers.get("origin") !== url.origin || url.origin === "null")
    return json({ error: "forbidden" }, 403);
  const secure = url.protocol === "https:";
  if (!secure && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    return json({ error: "https_required" }, 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
    request.headers.get("x-trakt-client") !== "1"
  )
    return json({ error: "bad_request" }, 400);
  const clear = (name: string) => serializeCookie(name, "", { secure, maxAge: 0 });
  if (endpoint === "/api/session/logout") {
    const headers = new Headers();
    headers.append("Set-Cookie", clear(SESSION_COOKIE));
    headers.append("Set-Cookie", clear(STATE_COOKIE));
    return json({ ok: true }, 200, headers);
  }
  const config = getServerConfig(env);
  if (!config) {
    // An intentionally unconfigured local deployment can retain token mode.
    // Broken/partial production configuration must not silently downgrade it.
    return !env.GOOGLE_CLIENT_SECRET && !env.GOOGLE_SESSION_PASSWORD
      ? json({ status: "unconfigured" })
      : json({ status: "error", error: "configuration_error" }, 503);
  }
  const cookies = parseCookies(request.headers.get("cookie"));
  if (endpoint === "/api/session/state") {
    const existing = await readChallenge(cookies[STATE_COOKIE], config.password);
    // Reuse a live challenge so opening Settings in a second tab does not break
    // a sign-in already in progress. Leave enough time to complete the dialog.
    if (existing && existing.expiresAt > Date.now() + 120_000)
      return json({ status: "ready", state: existing.state, expiresAt: existing.expiresAt });
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const challenge: Challenge = {
      purpose: "oauth-state",
      state,
      expiresAt: Date.now() + STATE_TTL * 1000,
    };
    const sealed = await sealData(challenge, { password: config.password, ttl: STATE_TTL });
    return json({ status: "ready", state, expiresAt: challenge.expiresAt }, 200, {
      "Set-Cookie": serializeCookie(STATE_COOKIE, sealed, { secure, maxAge: STATE_TTL }),
    });
  }
  if (endpoint === "/api/session/exchange") {
    let input: Record<string, unknown>;
    try {
      input = await boundedJson(request);
    } catch (error) {
      return json(
        { error: "invalid_request" },
        error instanceof Error && error.message === "payload_too_large" ? 413 : 400,
      );
    }
    const challenge = await readChallenge(cookies[STATE_COOKIE], config.password);
    if (
      !validString(input.code, 4096) ||
      !validString(input.state, 64) ||
      !challenge ||
      challenge.state !== input.state
    )
      return json({ error: "invalid_state" }, 400);
    const headers = new Headers({ "Set-Cookie": clear(STATE_COOKIE) });
    try {
      const result = await googleTokens(
        { grant_type: "authorization_code", code: input.code, redirect_uri: url.origin },
        config,
      );
      if (!result.ok)
        return json(
          {
            status: "error",
            error: result.body.error === "invalid_grant" ? "needs_consent" : "upstream_error",
          },
          result.body.error === "invalid_grant" ? 400 : 503,
          headers,
        );
      const access = accessResult(result.body);
      if (!access) return json({ status: "error", error: "invalid_token_response" }, 502, headers);
      // Never reuse a prior account's refresh token with this code's access token.
      if (!validString(result.body.refresh_token, 2048))
        return json({ status: "error", error: "missing_refresh_token" }, 400, headers);
      const sealed = await sealSession(
        { refreshToken: result.body.refresh_token, clientId: config.clientId },
        config.password,
      );
      headers.append(
        "Set-Cookie",
        serializeCookie(SESSION_COOKIE, sealed, { secure, maxAge: SESSION_TTL }),
      );
      return json(access, 200, headers);
    } catch {
      return json({ status: "error", error: "upstream_error" }, 503, headers);
    }
  }
  const sealed = cookies[SESSION_COOKIE];
  if (!sealed) return json({ status: "unauthenticated" });
  const session = sealed.length <= 3800 ? await unsealSession(sealed, config.password) : undefined;
  if (!session || session.clientId !== config.clientId)
    return json({ status: "unauthenticated" }, 200, { "Set-Cookie": clear(SESSION_COOKIE) });
  try {
    const result = await googleTokens(
      { grant_type: "refresh_token", refresh_token: session.refreshToken },
      config,
    );
    if (!result.ok) {
      if (result.body.error === "invalid_grant")
        return json({ status: "unauthenticated" }, 200, { "Set-Cookie": clear(SESSION_COOKIE) });
      return json({ status: "error", error: "upstream_error" }, 503);
    }
    const access = accessResult(result.body);
    if (!access) return json({ status: "error", error: "invalid_token_response" }, 502);
    // Respect a rotated refresh credential if Google supplies one.
    if (validString(result.body.refresh_token, 2048))
      session.refreshToken = result.body.refresh_token;
    const renewed = await sealSession(session, config.password);
    return json(access, 200, {
      "Set-Cookie": serializeCookie(SESSION_COOKIE, renewed, { secure, maxAge: SESSION_TTL }),
    });
  } catch {
    return json({ status: "error", error: "upstream_error" }, 503);
  }
}
