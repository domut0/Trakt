import { chromium, devices } from "playwright";

const BASE = "http://localhost:8080";
const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  headless: true,
  executablePath: "/opt/pw-browsers/chromium",
  ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1,::1" } } : {}),
});
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  timezoneId: "UTC",
  reducedMotion: "reduce",
  ignoreHTTPSErrors: true,
});
await ctx.clock.setFixedTime(new Date("2026-08-20T09:12:00.000Z"));
const page = await ctx.newPage();
page.on("requestfailed", (r) => console.log("REQFAIL", r.url().slice(0, 120), r.failure()?.errorText));

await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('nav[aria-label="Primary"]');
await page.waitForFunction(() => {
  const el = document.querySelector('nav[aria-label="Primary"]');
  return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"));
}, null, { timeout: 30000 });
console.log("hydrated ok");
await page.evaluate(() => document.fonts.ready);
const fonts = await page.evaluate(() =>
  [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`).slice(0, 8),
);
console.log("FONTS:", fonts);
const usedFont = await page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
console.log("h1 font-family:", usedFont);
await page.screenshot({ path: "/home/user/AnythingButTheNotesApp/screenshots/_debug-fonts.png" });
await browser.close();
