import { chromium } from "playwright";
import assert from "node:assert/strict";

// Run against a built/deployed app, not Vite dev (which has no service worker).
// Set TRAKT_CHECK_URL to its origin. Each pass uses a new isolated browser
// context; fixture values only enter that context's local IndexedDB.
const base = process.env.TRAKT_CHECK_URL || "http://127.0.0.1:8081";
const browser = await chromium.launch();
// These zones differ by a full day, so a server-rendered "today" cannot match
// both. This reproduces date hydration regressions at any time of day.
const timezones = process.env.TRAKT_CHECK_TIMEZONE
  ? [process.env.TRAKT_CHECK_TIMEZONE]
  : ["Pacific/Honolulu", "Pacific/Kiritimati"];

async function verify(timezoneId) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId,
  });
  const page = await context.newPage();
  const errors = [];
  let popups = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("popup", () => popups++);
  try {
    const response = await page.goto(base);
    assert.equal(response.status(), 200);
    await page.getByLabel("Bodyweight", { exact: true }).click();
    await page.evaluate(async () => {
      let timer;
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Service worker did not become ready")),
              30000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
    await page.reload();
    await page.getByLabel("Bodyweight", { exact: true }).click();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.getByLabel("Bodyweight", { exact: true }).fill("83.4");
    await page.getByLabel("Steps", { exact: true }).fill("0");
    await page.getByLabel("Calories", { exact: true }).fill("2400");
    await page.getByLabel("Bodyweight", { exact: true }).click();
    await page.waitForFunction(async () => {
      const records = await new Promise((resolve, reject) => {
        const request = indexedDB.open("workout-tracker");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("dailyLogs", "readonly");
          const read = tx.objectStore("dailyLogs").getAll();
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
          tx.oncomplete = () => db.close();
        };
      });
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      return records.some(
        (row) =>
          row.date === today && row.bodyweight === 83.4 && row.steps === 0 && row.calories === 2400,
      );
    });
    for (const route of ["/plan", "/clients"]) {
      const response = await page.goto(base + route);
      assert.equal(response.status(), 200, `Route failed: ${route}`);
      await page.getByRole("link", { name: "Today", exact: true }).waitFor();
    }
    await page.goto(base);
    await page.getByLabel("Bodyweight", { exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Bodyweight"]').value === "83.4",
    );
    await context.setOffline(true);
    const offlineResponse = await page.reload();
    assert.equal(offlineResponse.status(), 200);
    await page.getByLabel("Bodyweight", { exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Bodyweight"]').value === "83.4",
    );
    assert.equal(await page.getByLabel("Steps", { exact: true }).inputValue(), "0");
    assert.equal(await page.getByLabel("Calories", { exact: true }).inputValue(), "2400");
    assert.deepEqual(errors, []);
    assert.equal(popups, 0);
    console.log(
      `${base} (${timezoneId}): Today, Plan and Clients returned 200; service worker active; values saved to the local calendar date and survived online/offline reload; no JS errors or popups.`,
    );
  } catch (error) {
    console.log("Browser errors:", errors);
    console.log("Body:", await page.locator("body").innerText());
    throw error;
  } finally {
    await context.close();
  }
}

try {
  for (const timezone of timezones) await verify(timezone);
} finally {
  await browser.close();
}
