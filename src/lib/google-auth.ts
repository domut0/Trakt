/** Google credentials only. Fitness data and sheet configuration never pass through here. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const PENDING_LOGOUT_KEY = "trakt_pending_logout";
const RENEW_MARGIN_MS = 60_000;
const FRESH_SESSION_MS = 5 * 60_000;
const GIS_LOAD_TIMEOUT_MS = 15_000;
const INTERACTIVE_TIMEOUT_MS = 120_000;

export type AuthFailure =
  | "needs-consent"
  | "no-client-id"
  | "script-blocked"
  | "popup-blocked"
  | "timeout"
  | "network"
  | "missing-refresh-token";
export function withTimeout<T>(promise: Promise<T>, ms: number, reason: AuthFailure): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface CodeResponse {
  code?: string;
  state?: string;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}
interface CodeClient {
  requestCode: () => void;
}
interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        include_granted_scopes?: boolean;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }) => TokenClient;
      initCodeClient?: (config: {
        client_id: string;
        scope: string;
        include_granted_scopes: boolean;
        ux_mode: "popup";
        state: string;
        callback: (response: CodeResponse) => void;
        error_callback: (error: { type?: string }) => void;
      }) => CodeClient;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}
interface Credential {
  token: string;
  expiresAt: number;
  browserSessionAt?: number;
}
interface SessionResponse {
  status?: string;
  accessToken?: string;
  expiresIn?: number;
  state?: string;
  expiresAt?: number;
  error?: string;
  ok?: boolean;
}
interface Prepared {
  mode: "persistent" | "legacy";
  state?: string;
  expiresAt: number;
}
let cached: Credential | undefined;
let pickerCached: Credential | undefined;
let scriptPromise: Promise<void> | undefined;
let preparation: Promise<void> | undefined;
let prepared: Prepared | undefined;
let sessionUnavailable = false;
let generation = 0;
let pendingLogoutMemory = false;
let sessionInflight: Promise<SessionResponse> | undefined;
let logoutInflight: Promise<void> | undefined;
let interactiveInflight: Promise<string> | undefined;
let cancelInteractive: (() => void) | undefined;
let tokenClient: TokenClient | undefined;
let tokenAnswer: ((response: TokenResponse) => void) | undefined;
let tokenError: ((error: { type?: string }) => void) | undefined;
const controllers = new Set<AbortController>();
type TokenSource = (interactive: boolean) => Promise<string>;
let tokenSourceImpl: TokenSource | undefined;

export function isPendingLogout(): boolean {
  try {
    return pendingLogoutMemory || localStorage.getItem(PENDING_LOGOUT_KEY) === "1";
  } catch {
    return pendingLogoutMemory;
  }
}
function markLogout(value: boolean): void {
  pendingLogoutMemory = value;
  try {
    if (value) localStorage.setItem(PENDING_LOGOUT_KEY, "1");
    else localStorage.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    /* Memory still prevents recovery when browser storage is unavailable. */
  }
}
/** Forget access in this page. Reauthorization must NOT destroy the durable grant. */
export function clearGoogleToken(): void {
  generation++;
  cached = pickerCached = undefined;
  cancelInteractive?.();
  cancelInteractive = undefined;
  tokenClient = undefined;
  tokenAnswer = tokenError = undefined;
  interactiveInflight = sessionInflight = undefined;
  preparation = undefined;
  for (const controller of controllers) controller.abort();
  controllers.clear();
}

/** A Google 401 may arrive before the advertised expiry; retire only that token. */
export function expireGoogleToken(token: string): void {
  if (cached?.token === token) cached = undefined;
}
export function setGoogleTokenSource(fn: TokenSource | undefined): void {
  clearGoogleToken();
  tokenSourceImpl = fn;
  prepared = preparation = scriptPromise = undefined;
  logoutInflight = undefined;
  sessionUnavailable = false;
  markLogout(false);
}
/** The marker remains until deliberate sign-in, including after a successful logout.
 * A late response in another tab must not silently reconnect this browser. */
export function disconnectGoogleSession(): Promise<void> {
  markLogout(true);
  clearGoogleToken();
  prepared = undefined;
  if (tokenSourceImpl) return Promise.resolve();
  return flushLogout();
}
function flushLogout(): Promise<void> {
  if (logoutInflight) return logoutInflight;
  const request = sessionPost("/logout").then((data) => {
    if (!data.ok) throw new Error("network");
  });
  logoutInflight = request;
  void request
    .finally(() => {
      if (logoutInflight === request) logoutInflight = undefined;
    })
    .catch(() => {});
  return request;
}
export function googleClientId(): string | undefined {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;
}
async function sessionPost(
  path = "",
  body: unknown = {},
  signal?: AbortSignal,
): Promise<SessionResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  controllers.add(controller);
  try {
    const response = await withTimeout(
      (async () => {
        const result = await fetch(`/api/session${path}`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { "Content-Type": "application/json", "X-Trakt-Client": "1" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const data = (await result.json()) as SessionResponse;
        if (!result.ok) {
          if (data.error === "missing_refresh_token") throw new Error("missing-refresh-token");
          if (data.error === "needs_consent" || data.error === "invalid_state")
            throw new Error("needs-consent");
          throw new Error("network");
        }
        return data;
      })(),
      15_000,
      "timeout",
    );
    return response;
  } finally {
    controller.abort();
    controllers.delete(controller);
    signal?.removeEventListener("abort", abort);
  }
}
function checkGeneration(start: number): void {
  if (start !== generation) throw new Error("needs-consent");
}
function credential(data: SessionResponse, browserSession = false): Credential {
  if (
    typeof data.accessToken !== "string" ||
    !data.accessToken ||
    typeof data.expiresIn !== "number" ||
    !Number.isFinite(data.expiresIn) ||
    data.expiresIn <= 60
  )
    throw new Error("network");
  return {
    token: data.accessToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
    browserSessionAt: browserSession ? Date.now() : undefined,
  };
}
async function recoverSession(): Promise<SessionResponse> {
  if (sessionInflight) return sessionInflight;
  const start = generation;
  const request = sessionPost().then((data) => {
    checkGeneration(start);
    if (isPendingLogout()) throw new Error("needs-consent");
    if (data.status === "authenticated") {
      cached = credential(data);
      sessionUnavailable = false;
    } else if (data.status === "unauthenticated" || data.status === "unconfigured")
      sessionUnavailable = true;
    else throw new Error("network");
    return data;
  });
  sessionInflight = request;
  try {
    return await request;
  } finally {
    if (sessionInflight === request) sessionInflight = undefined;
  }
}
function loadGis(): Promise<void> {
  if (typeof window !== "undefined" && window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("script-blocked"));
    const el = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      el.remove();
      scriptPromise = undefined;
      reject(new Error("script-blocked"));
    };
    const timer = setTimeout(fail, GIS_LOAD_TIMEOUT_MS);
    el.src = GIS_SRC;
    el.async = true;
    el.onload = () => {
      clearTimeout(timer);
      if (window.google?.accounts?.oauth2) resolve();
      else fail();
    };
    el.onerror = fail;
    document.head.appendChild(el);
  });
  return scriptPromise;
}
function ensureTokenClient(): void {
  if (tokenClient) return;
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error("script-blocked");
  const client = oauth.initTokenClient({
    client_id: googleClientId()!,
    scope: DRIVE_FILE_SCOPE,
    include_granted_scopes: false,
    callback: (data) => {
      if (tokenClient === client) tokenAnswer?.(data);
    },
    error_callback: (error) => {
      if (tokenClient === client) tokenError?.(error);
    },
  });
  tokenClient = client;
}
async function prepare(): Promise<void> {
  if (prepared && prepared.expiresAt > Date.now() + INTERACTIVE_TIMEOUT_MS) return;
  if (preparation) return preparation;
  const start = generation;
  const request = (async () => {
    if (isPendingLogout()) await flushLogout();
    const [data] = await Promise.all([sessionPost("/state"), loadGis()]);
    checkGeneration(start);
    if (data.status === "unconfigured") {
      prepared = { mode: "legacy", expiresAt: Date.now() + 300_000 };
      ensureTokenClient();
    } else if (
      data.status === "ready" &&
      typeof data.state === "string" &&
      typeof data.expiresAt === "number"
    ) {
      prepared = { mode: "persistent", state: data.state, expiresAt: data.expiresAt };
    } else throw new Error("network");
  })();
  preparation = request;
  try {
    await request;
  } finally {
    if (preparation === request) preparation = undefined;
  }
}
/** Prepare the challenge and Google script before a tap; never open a window. */
export function warmGoogleAuth(): Promise<void> {
  if (tokenSourceImpl || !googleClientId()) return Promise.resolve();
  return Promise.all([prepare(), isPendingLogout() ? Promise.resolve() : recoverSession()]).then(
    () => {},
    () => {},
  );
}
export interface TokenRequest {
  interactive: boolean;
  freshSession?: boolean;
  reauthorize?: boolean;
}
export async function getAccessToken({
  interactive,
  freshSession,
  reauthorize,
}: TokenRequest): Promise<string> {
  if (tokenSourceImpl) return tokenSourceImpl(interactive);
  const start = generation;
  if (!googleClientId()) throw new Error("no-client-id");
  const usable = freshSession ? (pickerCached ?? cached) : cached;
  if (
    !isPendingLogout() &&
    !reauthorize &&
    usable &&
    usable.expiresAt - RENEW_MARGIN_MS > Date.now() &&
    (!freshSession || (usable.browserSessionAt ?? -Infinity) + FRESH_SESSION_MS > Date.now())
  )
    return usable.token;
  if (!interactive && isPendingLogout()) throw new Error("needs-consent");
  // A prepared user action must open synchronously, preserving iOS activation.
  if (
    interactive &&
    prepared &&
    prepared.expiresAt > Date.now() + INTERACTIVE_TIMEOUT_MS &&
    (reauthorize || freshSession || sessionUnavailable || isPendingLogout())
  )
    return requestInteractive(!!freshSession);
  if (!isPendingLogout() && !reauthorize && !freshSession) {
    const result = await recoverSession();
    checkGeneration(start);
    if (result.status === "authenticated") return cached!.token;
  }
  if (!interactive) throw new Error("needs-consent");
  await prepare();
  checkGeneration(start);
  return requestInteractive(!!freshSession);
}
function requestInteractive(freshSession: boolean): Promise<string> {
  if (interactiveInflight) return interactiveInflight;
  const setup = prepared!;
  // Picker also needs first-party Google cookies. A token minted solely for its
  // iframe is never combined with the server's existing account credential.
  const pickerOnly = freshSession && setup.mode === "persistent" && !isPendingLogout();
  const legacy = setup.mode === "legacy" || pickerOnly;
  if (!legacy) {
    // Retire any old-account refresh before the user chooses an account. Keep
    // background callers (including other tabs) paused until exchange finishes.
    // Otherwise a slow refresh could overwrite the newly chosen account.
    markLogout(true);
    clearGoogleToken();
  }
  const start = generation;
  const exchangeController = new AbortController();
  let finished = false;
  const promise = new Promise<string>((resolve, reject) => {
    const finish = (error?: Error, value?: string) => {
      if (finished) return;
      finished = true;
      exchangeController.abort();
      clearTimeout(timer);
      tokenAnswer = tokenError = undefined;
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      tokenClient = undefined;
      prepared = undefined;
      finish(new Error("timeout"));
    }, INTERACTIVE_TIMEOUT_MS);
    cancelInteractive = () => finish(new Error("needs-consent"));
    const fail = (error: { type?: string }) =>
      finish(new Error(error.type === "popup_failed_to_open" ? "popup-blocked" : "needs-consent"));
    if (legacy) {
      try {
        ensureTokenClient();
        tokenAnswer = (data) => {
          if (finished || start !== generation) return;
          if (data.error || !data.access_token) return finish(new Error("needs-consent"));
          const value = credential(
            { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 },
            true,
          );
          if (pickerOnly) pickerCached = value;
          else {
            cached = value;
            markLogout(false);
            sessionUnavailable = false;
          }
          finish(undefined, value.token);
        };
        // Keep the legacy one-retry behavior, without introducing automatic dialogs.
        let retried = false;
        tokenError = (error) => {
          if (error.type === "popup_failed_to_open" && !retried) {
            retried = true;
            try {
              tokenClient!.requestAccessToken();
            } catch {
              fail(error);
            }
          } else fail(error);
        };
        tokenClient!.requestAccessToken();
      } catch {
        finish(new Error("popup-blocked"));
      }
      return;
    }
    try {
      const oauth = window.google?.accounts?.oauth2;
      if (!oauth?.initCodeClient || !setup.state) return finish(new Error("script-blocked"));
      const client = oauth.initCodeClient({
        client_id: googleClientId()!,
        scope: DRIVE_FILE_SCOPE,
        include_granted_scopes: false,
        ux_mode: "popup",
        state: setup.state,
        callback: (response) => {
          if (finished || start !== generation) return;
          if (response.error || !response.code || response.state !== setup.state)
            return finish(new Error("needs-consent"));
          prepared = undefined;
          void sessionPost(
            "/exchange",
            { code: response.code, state: response.state },
            exchangeController.signal,
          )
            .then((data) => {
              if (finished || start !== generation) return;
              if (data.status !== "authenticated") return finish(new Error("needs-consent"));
              cached = credential(data, true);
              markLogout(false);
              sessionUnavailable = false;
              finish(undefined, cached.token);
            })
            .catch((error) => finish(error instanceof Error ? error : new Error("network")));
        },
        error_callback: fail,
      });
      client.requestCode();
    } catch {
      finish(new Error("popup-blocked"));
    }
  });
  interactiveInflight = promise;
  void promise
    .finally(() => {
      if (interactiveInflight === promise) {
        interactiveInflight = undefined;
        cancelInteractive = undefined;
      }
    })
    .catch(() => {});
  return promise;
}

// Keep already-open tabs from retaining the old account after a disconnect or
// deliberate reconnect in another tab. The marker contains no credentials.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === PENDING_LOGOUT_KEY) {
      pendingLogoutMemory = event.newValue === "1";
      clearGoogleToken();
      prepared = undefined;
    }
  });
}
