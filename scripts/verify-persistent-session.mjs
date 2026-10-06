// Production-bundle QA with fictional credentials and a fake Google boundary.
// Never run against a live client account: this script owns its local server.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

process.env.VITE_GOOGLE_CLIENT_ID = "fixture-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "fixture-client-secret";
process.env.GOOGLE_SESSION_PASSWORD = randomBytes(48).toString("base64url");
const nativeFetch = globalThis.fetch;
let exchanges = 0;
let refreshes = 0;
globalThis.fetch = async (url, options) => {
  if (String(url) !== "https://oauth2.googleapis.com/token") return nativeFetch(url, options);
  const params = options.body;
  if (params.get("grant_type") === "authorization_code") {
    exchanges++;
    assert.equal(params.get("redirect_uri"), "http://127.0.0.1:8081");
    return Response.json({
      access_token: "fixture-access",
      expires_in: 3600,
      refresh_token: "fixture-refresh",
    });
  }
  refreshes++;
  assert.equal(params.get("refresh_token"), "fixture-refresh");
  return Response.json({ access_token: "fixture-renewed", expires_in: 3600 });
};
const { default: app } = await import("../.vercel/output/functions/__server.func/index.mjs");
const root = resolve(".vercel/output/static");
const types = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:8081");
    const file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (file.startsWith(root + sep) && (await stat(file).catch(() => null))?.isFile()) {
      res.setHeader("content-type", types[extname(file)] || "application/octet-stream");
      res.end(await readFile(file));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await app.fetch(
      new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      }),
    );
    for (const [key, value] of response.headers)
      if (key !== "set-cookie") res.setHeader(key, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.statusCode = response.status;
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    res.writeHead(500);
    res.end("Fixture server failed");
  }
});
await new Promise((resolve) => server.listen(8081, "127.0.0.1", resolve));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [];
const googleRequests = [];
let dialogs = 0;
let gisRequests = 0;
await context.exposeBinding("fixtureCodeRequested", (_, active) => {
  assert.equal(active, true, "Google dialog lost the tap's user activation");
  gisRequests++;
});
await context.addInitScript(() => {
  window.google = {
    accounts: {
      oauth2: {
        initCodeClient: (config) => ({
          requestCode() {
            void window.fixtureCodeRequested(navigator.userActivation.isActive);
            queueMicrotask(() => config.callback({ code: "fixture-code", state: config.state }));
          },
        }),
        initTokenClient: () => ({
          requestAccessToken() {
            throw new Error("Unexpected legacy token dialog");
          },
        }),
      },
    },
  };
});
await context.route("https://sheets.googleapis.com/**", async (route) => {
  googleRequests.push({ url: route.request().url(), method: route.request().method() });
  // Keep the existing app data untouched; a retryable Google outage cannot merge
  // a blank fixture sheet or write any real spreadsheet.
  await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
});
function observe(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("popup", () => dialogs++);
}
async function snapshot(page) {
  return page.evaluate(
    async () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("workout-tracker");
        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
          const db = request.result;
          const result = {};
          for (const name of db.objectStoreNames)
            result[name] = await new Promise((done, fail) => {
              const read = db.transaction(name).objectStore(name).getAll();
              read.onsuccess = () => done(read.result);
              read.onerror = () => fail(read.error);
            });
          db.close();
          resolve(result);
        };
      }),
  );
}
let page = await context.newPage();
observe(page);
try {
  await page.goto("http://127.0.0.1:8081");
  await page.getByLabel("Bodyweight", { exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}));
  await page.evaluate(
    async () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("workout-tracker");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            ["meta", "dailyLogs", "coachClients", "sessions", "sets"],
            "readwrite",
          );
          tx.objectStore("meta").put({
            key: "syncConfig",
            kind: "google",
            spreadsheetId: "fixture-existing-sheet",
            deviceId: "fixture-device",
            url: "",
            secret: "",
            enabled: true,
          });
          tx.objectStore("meta").put({ key: "deviceId", deviceId: "fixture-device" });
          tx.objectStore("meta").put({
            key: "syncBase",
            base: {
              revision: 7,
              sets: { "fixture-set": { weight: 85, reps: 8 } },
              sessions: { "active-fixture": {} },
              dailyLogs: {
                "2026-10-04": {
                  bodyweight: 83.4,
                  steps: 0,
                  calories: 2400,
                  protein: 175,
                  carbs: 250,
                  fat: 70,
                },
              },
            },
          });
          tx.objectStore("dailyLogs").put({
            date: "2026-10-04",
            bodyweight: 83.4,
            steps: 0,
            calories: 2400,
            protein: 175,
            carbs: 250,
            fat: 70,
          });
          tx.objectStore("coachClients").put({
            id: "client-a",
            kind: "google",
            name: "Maya",
            spreadsheetId: "fixture-client-a",
          });
          tx.objectStore("coachClients").put({
            id: "client-b",
            kind: "google",
            name: "Alex",
            spreadsheetId: "fixture-client-b",
          });
          tx.objectStore("sessions").put({
            id: "active-fixture",
            startedAt: 123,
            addedExerciseIds: ["exercise-a"],
            substitutions: { "exercise-b": "exercise-a" },
            exerciseOrder: ["exercise-a"],
          });
          tx.objectStore("sets").put({
            id: "fixture-set",
            sessionId: "active-fixture",
            exerciseId: "exercise-a",
            weight: 85,
            reps: 8,
            loggedAt: 123,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  const stateReady = page.waitForResponse(
    (response) => response.url().endsWith("/api/session/state") && response.status() === 200,
  );
  await page.reload();
  await page.getByRole("button", { name: "Reconnect Google", exact: true }).waitFor();
  await (await stateReady).finished();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const before = await snapshot(page);
  const firstRead = page.waitForResponse(
    (response) => response.url().includes("sheets.googleapis.com") && response.status() === 503,
  );
  await page.getByRole("button", { name: "Reconnect Google", exact: true }).click();
  await firstRead;
  assert.equal(exchanges, 1);
  assert.equal(gisRequests, 1);
  assert.deepEqual(await snapshot(page), before, "Reconnect changed durable data");
  const cookie = (await context.cookies()).find((value) => value.name === "trakt_session");
  assert.ok(cookie?.httpOnly);
  assert.equal(cookie.path, "/api/session");
  assert.equal(cookie.value.includes("fixture-refresh"), false);
  assert.equal(await page.evaluate(() => document.cookie.includes("trakt_session")), false);
  assert.equal(
    await page.evaluate(() => JSON.stringify(localStorage).includes("fixture-access")),
    false,
  );
  await page.close();
  page = await context.newPage();
  observe(page);
  const coldRecovery = page.waitForResponse(
    (response) => response.url().endsWith("/api/session") && response.request().method() === "POST",
  );
  await page.goto("http://127.0.0.1:8081");
  await page.getByLabel("Bodyweight", { exact: true }).click();
  await page.waitForFunction(() => document.readyState === "complete");
  assert.equal((await (await coldRecovery).json()).status, "authenticated");
  assert.ok(refreshes >= 1);
  assert.equal(gisRequests, 1);
  assert.equal(
    await page.getByRole("button", { name: "Reconnect Google", exact: true }).count(),
    0,
  );
  assert.deepEqual(await snapshot(page), before, "Cold reopening changed durable data");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel("Bodyweight", { exact: true }).click();
  assert.deepEqual(await snapshot(page), before, "Offline reload changed durable data");
  assert.equal(gisRequests, 1);
  assert.equal(dialogs, 0);
  assert.deepEqual(errors, []);
  assert.ok(googleRequests.length >= 1);
  assert.ok(
    googleRequests.every(
      (request) =>
        ["fixture-existing-sheet", "fixture-client-a", "fixture-client-b"].some((id) =>
          request.url.includes(id),
        ) && request.method === "GET",
    ),
    JSON.stringify(googleRequests),
  );
  assert.ok(googleRequests.some((request) => request.url.includes("fixture-existing-sheet")));
  console.log(
    "Persistent-session browser QA passed: one deliberate code request, encrypted HttpOnly cookie, silent cold-open renewal, original sheet reused, all IndexedDB tables unchanged after reconnect/reopen/offline reload, no JS errors or automatic dialogs.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = nativeFetch;
}
