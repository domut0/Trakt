#!/usr/bin/env node
/**
 * Repeatable screenshot harness for the fitness PWA.
 *
 * Boots the dev server (or reuses one via SCREENSHOT_BASE_URL), seeds a
 * deterministic dataset through the app's own JSON backup import, and captures
 * every significant screen and sheet at iPhone dimensions into screenshots/.
 *
 *   npm run screenshots
 *   SCREENSHOT_BASE_URL=http://localhost:8080 npm run screenshots   # reuse a server
 *   SCREENSHOT_ONLY=charts npm run screenshots                      # substring filter
 *   SCREENSHOT_HEADED=1 npm run screenshots                         # watch it run
 *
 * Everything the seed contains is derived from a FROZEN "today"
 * (see FROZEN_NOW), and the browser clock is pinned to the same instant, so two
 * runs a week apart produce pixel-comparable before/after screenshots.
 *
 * Exits non-zero with a readable message on any failure, including a screenshot
 * that came out suspiciously small (blank page) or a Vite error overlay.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "screenshots");

const PORT = Number(process.env.SCREENSHOT_PORT || 8080);
const EXTERNAL_BASE_URL = process.env.SCREENSHOT_BASE_URL || "";
const BASE_URL = EXTERNAL_BASE_URL || `http://localhost:${PORT}`;
const HEADED = !!process.env.SCREENSHOT_HEADED;
const ONLY = process.env.SCREENSHOT_ONLY || "";
/** A 390x844@2 PNG of a genuinely blank page lands around 6-8 KB. Anything
 * under this is a white screen or an error page, not a rendered app. */
const MIN_PNG_BYTES = 9000;
const SERVER_BOOT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Deterministic seed data
// ---------------------------------------------------------------------------

/** The instant the whole run pretends it is. Thursday, 20 Aug 2026, 09:12 UTC.
 * The browser context runs in UTC so this is also the local date, which is what
 * the app's `dayKey` keys everything on. */
const FROZEN_NOW = new Date("2026-08-20T09:12:00.000Z");
const DAY_MS = 86_400_000;
/** Six weeks of history: enough for the 7/30/All chart ranges to differ. */
const HISTORY_DAYS = 42;

/** Deterministic pseudo-random in [0,1). Same seed, same run, forever. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UTC "yyyy-MM-dd" — matches the app's local dayKey because the context is UTC. */
function dayKeyOf(date) {
  return date.toISOString().slice(0, 10);
}

/** Date `offset` days before the frozen today. */
function dayBefore(offset) {
  return new Date(FROZEN_NOW.getTime() - offset * DAY_MS);
}

/** Monday-first weekday index (0 = Mon ... 6 = Sun), the app's convention. */
function weekdayIndex(date) {
  return (date.getUTCDay() + 6) % 7;
}

/** Epoch ms for a given clock time on `date`, in UTC. */
function atTime(date, hour, minute) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0);
}

const round1 = (n) => Math.round(n * 10) / 10;

/** The exercise library the seeded backups carry. A curated subset of the app's
 * own preset list (ids kept identical) so the picker looks real without the
 * 150-row library making the search screenshot unreadable. */
const EXERCISES = [
  { id: "e_bench", name: "Bench Press", type: "main" },
  { id: "e_squat", name: "Back Squat", type: "main" },
  { id: "e_dead", name: "Deadlift", type: "main" },
  { id: "e_incline_bench", name: "Incline Bench Press", type: "main" },
  { id: "e_close_grip_bench", name: "Close-Grip Bench Press", type: "main" },
  { id: "e_ohp", name: "Overhead Press", type: "main" },
  { id: "e_rdl", name: "Romanian Deadlift", type: "main" },
  { id: "e_barbell_row", name: "Barbell Row", type: "accessory" },
  { id: "e_lat_pulldown", name: "Lat Pulldown", type: "accessory" },
  { id: "e_incline_db_press", name: "Incline Dumbbell Press", type: "accessory" },
  { id: "e_cable_fly", name: "Cable Fly", type: "accessory" },
  { id: "e_push", name: "Tricep Pushdown", type: "accessory" },
  { id: "e_curl", name: "Incline DB Curl", type: "accessory" },
  { id: "e_leg_extension", name: "Leg Extension", type: "accessory" },
  { id: "e_lying_leg_curl", name: "Lying Leg Curl", type: "accessory" },
  { id: "e_face_pull", name: "Face Pull", type: "accessory" },
  { id: "e_flap", name: "Keenan Flaps", type: "accessory", setupNote: "seat: 4, pins: 12" },
  { id: "e_treadmill", name: "Treadmill Run", type: "cardio" },
  { id: "e_bike", name: "Zone 2 Bike", type: "cardio" },
];

const SLOTS = [
  { id: "s_hb", name: "Heavy Bench", rotationOrder: 0 },
  { id: "s_pull", name: "Pull", rotationOrder: 1 },
  { id: "s_vb", name: "Volume Bench", rotationOrder: 2 },
  { id: "s_sq", name: "Squat", rotationOrder: 3 },
];

/** Which split runs on which weekday, and what is in it. Mon/Tue/Thu/Fri lift,
 * Sat is cardio, Wed/Sun are rest. A fixed weekly template keeps the calendar
 * and the weekly view legible instead of looking randomly sprinkled. */
const SPLIT_BY_WEEKDAY = {
  0: {
    slotId: "s_hb",
    plan: [
      { exerciseId: "e_bench", sets: 4, weight: 205, reps: 5, rpe: 8 },
      { exerciseId: "e_close_grip_bench", sets: 3, weight: 155, reps: 8, rpe: 8 },
      { exerciseId: "e_push", sets: 3, weight: 60, reps: 12 },
    ],
  },
  1: {
    slotId: "s_pull",
    plan: [
      { exerciseId: "e_barbell_row", sets: 4, weight: 165, reps: 8, rpe: 8 },
      { exerciseId: "e_lat_pulldown", sets: 3, weight: 130, reps: 10 },
      { exerciseId: "e_curl", sets: 3, weight: 30, reps: 12 },
    ],
  },
  3: {
    slotId: "s_vb",
    plan: [
      { exerciseId: "e_bench", sets: 4, weight: 165, reps: 10, rpe: 7 },
      { exerciseId: "e_incline_db_press", sets: 3, weight: 60, reps: 10 },
      { exerciseId: "e_cable_fly", sets: 3, weight: 35, reps: 15 },
    ],
  },
  4: {
    slotId: "s_sq",
    plan: [
      { exerciseId: "e_squat", sets: 4, weight: 275, reps: 5, rpe: 8 },
      { exerciseId: "e_rdl", sets: 3, weight: 205, reps: 8, rpe: 7 },
      { exerciseId: "e_leg_extension", sets: 3, weight: 110, reps: 12 },
    ],
  },
};

const SESSION_NOTES = {
  2: "Felt strong, bar speed good.",
  9: "Shoulder a bit cranky - cut the flyes short.",
  17: "Slept badly. Kept it easy.",
};

const HABITS = [
  { id: "h_creatine", name: "Creatine", order: 0 },
  { id: "h_vitd", name: "Vitamin D", order: 1 },
  { id: "h_water", name: "3L water", order: 2 },
  { id: "h_stretch", name: "Stretch 10 min", order: 3 },
  { id: "h_cold", name: "Cold shower", order: 4, archived: true },
];

const TARGET_PROFILES = [
  {
    id: "tp_train",
    name: "Training",
    calories: 2700,
    protein: 200,
    carbs: 300,
    fat: 80,
    steps: 10000,
  },
  { id: "tp_rest", name: "Rest", calories: 2200, protein: 190, carbs: 180, fat: 75, steps: 8000 },
];
/** Monday first. Wed/Sat/Sun are rest days. */
const WEEKDAY_TARGETS = [
  "tp_train",
  "tp_train",
  "tp_rest",
  "tp_train",
  "tp_train",
  "tp_rest",
  "tp_rest",
];

/**
 * The populated backup: six weeks of lifting, cardio, nutrition, habits and
 * per-weekday targets, all pinned to FROZEN_NOW.
 *
 * Two days are shaped deliberately, because they are the states the redesign is
 * about:
 *  - TODAY is UNDER its 2,700 calorie goal but OVER protein (226/200) and OVER
 *    steps (12,480/10,000), so the Today card shows an under-filled ring above
 *    two red "OVER" bars at once.
 *  - YESTERDAY (a rest day, 2,200 cal) is OVER on calories, so the over-target
 *    ring treatment is reachable from the day editor and calendar too.
 */
function buildFullBackup() {
  const rand = rng(20260820);
  const sessions = [];
  const sets = [];
  const dailyLogs = [];
  const habitEntries = [];
  const slotLastLogged = {};

  for (let offset = HISTORY_DAYS - 1; offset >= 0; offset--) {
    const date = dayBefore(offset);
    const key = dayKeyOf(date);
    const wd = weekdayIndex(date);
    // 0 for the oldest week, 5 for the current one: drives linear progression.
    const weekIndex = Math.floor((HISTORY_DAYS - 1 - offset) / 7);

    // --- workouts -------------------------------------------------------
    const split = SPLIT_BY_WEEKDAY[wd];
    if (split) {
      const sessionId = `sess_${key}`;
      const startedAt = atTime(date, 7, 15);
      const session = {
        id: sessionId,
        splitSlotId: split.slotId,
        startedAt,
        endedAt: startedAt + 62 * 60_000,
      };
      if (SESSION_NOTES[offset]) session.note = SESSION_NOTES[offset];
      sessions.push(session);
      slotLastLogged[split.slotId] = session.endedAt;

      let cursor = startedAt + 5 * 60_000;
      split.plan.forEach((entry, planIdx) => {
        const blockGroupId = `blk_${key}_${planIdx}`;
        // Main lifts creep up 5 lb a week, accessories 2.5 lb.
        const step = entry.weight >= 150 ? 5 : 2.5;
        const weight = entry.weight + weekIndex * step;
        for (let s = 0; s < entry.sets; s++) {
          // The last set of a heavy block usually drops a rep.
          const reps = s === entry.sets - 1 && entry.reps > 5 ? entry.reps - 1 : entry.reps;
          cursor += 165_000 + Math.floor(rand() * 40_000);
          sets.push({
            id: `set_${key}_${planIdx}_${s}`,
            sessionId,
            exerciseId: entry.exerciseId,
            weight,
            reps,
            ...(entry.rpe ? { rpe: Math.min(10, entry.rpe + (s === entry.sets - 1 ? 1 : 0)) } : {}),
            ...(planIdx === 0 && s === 0 ? { setupNote: "bench: 2 clicks out, feet tucked" } : {}),
            blockGroupId,
            loggedAt: cursor,
          });
        }
      });
    } else if (wd === 5) {
      // Saturday cardio, logged after the fact the way `logCardio` writes it.
      const endedAt = atTime(date, 9, 40);
      const durationMinutes = 30 + Math.floor(rand() * 12);
      sessions.push({
        id: `cardio_${key}`,
        startedAt: endedAt - durationMinutes * 60_000,
        endedAt,
        kind: "cardio",
        cardioExerciseId: weekIndex % 2 === 0 ? "e_treadmill" : "e_bike",
        durationMinutes,
        distance: round1(3 + rand() * 1.8),
        setupNote: "incline 2",
      });
    }

    // --- daily log ------------------------------------------------------
    // Two untracked days and one partial day, because nobody logs 42 for 42 and
    // the charts need to show what a gap looks like.
    if (offset === 9 || offset === 23) continue;

    const isTrainingDay = !!split;
    const bodyweight = round1(186.4 - (HISTORY_DAYS - 1 - offset) * 0.105 + (rand() - 0.5) * 0.8);

    if (offset === 16) {
      dailyLogs.push({ date: key, steps: 7420, bodyweight });
      continue;
    }

    let log;
    if (offset === 0) {
      // Today: under on calories, over on protein and steps.
      log = {
        date: key,
        calories: 2180,
        protein: 226,
        carbs: 168,
        fat: 62,
        steps: 12480,
        bodyweight: 182.4,
      };
    } else if (offset === 1) {
      // Yesterday, a rest day with a 2,200 target: over on calories.
      log = {
        date: key,
        calories: 2540,
        protein: 178,
        carbs: 240,
        fat: 92,
        steps: 6410,
        bodyweight: 182.6,
      };
    } else {
      const calories = (isTrainingDay ? 2680 : 2170) + Math.round((rand() - 0.5) * 260);
      const protein = 188 + Math.round(rand() * 34);
      const carbs = (isTrainingDay ? 292 : 186) + Math.round((rand() - 0.5) * 60);
      const fat = 74 + Math.round((rand() - 0.5) * 22);
      const steps = (isTrainingDay ? 10200 : 8100) + Math.round((rand() - 0.5) * 3400);
      log = { date: key, calories, protein, carbs, fat, steps, bodyweight };
      // A couple of declared cheat days, on Saturdays. The offsets must BE
      // Saturdays or this never fires: against the frozen Thu 20 Aug 2026, the
      // original 8 and 29 are both Wednesdays, so this branch was dead and no
      // screenshot ever contained a cheat day with macros on it. That is
      // precisely the case where the cheat dot used to replace the food dot.
      if (wd === 5 && (offset === 12 || offset === 26)) {
        log.calories = 3480;
        log.carbs = 410;
        log.fat = 118;
        log.isCheatDay = true;
      }
    }
    // A cheat day carrying NO numbers, deliberately next to an untracked day so
    // the two cells can be compared directly in the calendar grid. This is the
    // case that was broken: the cheat flag did not count towards hasAnyDot, so
    // a day the user had explicitly marked drew nothing at all and looked
    // exactly like a day they never opened. Keep it in the seed so a regression
    // shows up in a screenshot rather than in a bug report.
    if (offset === 10) {
      log = { date: key, isCheatDay: true };
    }
    dailyLogs.push(log);

    // --- habits ---------------------------------------------------------
    const done = [];
    if (offset === 0) {
      // Today is deliberately half-finished so the checklist shows both states.
      done.push("h_creatine", "h_vitd");
    } else {
      if (rand() < 0.92) done.push("h_creatine");
      if (rand() < 0.72) done.push("h_vitd");
      if ((log.steps ?? 0) >= 9500) done.push("h_water");
      if (rand() < 0.48) done.push("h_stretch");
    }
    for (const habitId of done) {
      habitEntries.push({ id: `${key}|${habitId}`, date: key, habitId });
    }
  }

  const slots = SLOTS.map((s) => ({
    ...s,
    ...(slotLastLogged[s.id] ? { lastLoggedAt: slotLastLogged[s.id] } : {}),
  }));

  return {
    version: 4,
    exercises: EXERCISES,
    slots,
    sessions,
    sets,
    dailyLogs,
    habits: HABITS,
    habitEntries,
    targetProfiles: TARGET_PROFILES,
    weekdayTargets: WEEKDAY_TARGETS,
    targetsEnabled: true,
    habitsEnabled: true,
    toolsEnabled: true,
    unit: "lbs",
  };
}

/**
 * The empty backup: the exercise preset library and nothing else.
 *
 * The library has to be present. `hydrate()` re-seeds the demo history whenever
 * `db.exercises` is empty, so a backup that dropped the exercises would give us
 * the demo data back on the next reload instead of the empty screens we want.
 */
function buildEmptyBackup() {
  return {
    version: 4,
    exercises: EXERCISES,
    slots: [],
    sessions: [],
    sets: [],
    dailyLogs: [],
    habits: [],
    habitEntries: [],
    targetProfiles: [{ id: "tp_default", name: "Every day" }],
    weekdayTargets: Array.from({ length: 7 }, () => "tp_default"),
    targetsEnabled: false,
    habitsEnabled: false,
    toolsEnabled: false,
    unit: "lbs",
  };
}

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

async function isServerUp(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startDevServer() {
  if (EXTERNAL_BASE_URL) {
    log(`Using existing server at ${EXTERNAL_BASE_URL}`);
    if (!(await waitForServer(EXTERNAL_BASE_URL, 10_000))) {
      throw new Error(
        `SCREENSHOT_BASE_URL=${EXTERNAL_BASE_URL} is not responding. Start it, or unset the ` +
          `variable to let this script boot its own dev server.`,
      );
    }
    return null;
  }
  if (await isServerUp(BASE_URL)) {
    log(`A server is already listening on ${BASE_URL}; reusing it.`);
    return null;
  }

  log(`Booting dev server on port ${PORT}...`);
  const child = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let output = "";
  const capture = (chunk) => {
    output += chunk.toString();
    if (output.length > 20_000) output = output.slice(-20_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\nDev server exited early with code ${code}:\n${output}`);
    }
  });

  if (!(await waitForServer(BASE_URL, SERVER_BOOT_TIMEOUT_MS))) {
    child.kill("SIGTERM");
    throw new Error(
      `Dev server did not answer on ${BASE_URL} within ${SERVER_BOOT_TIMEOUT_MS / 1000}s.\n` +
        `Last output:\n${output}`,
    );
  }
  log(`Dev server ready at ${BASE_URL}`);
  return child;
}

// ---------------------------------------------------------------------------
// Web fonts
//
// The app loads Inter from Google Fonts. In a sandbox the browser usually
// cannot reach it, and the fallback on a bare Linux image is DejaVu Sans, which
// makes every screenshot lie about the product's typography. So the fonts are
// fetched once into a temp cache and served back to the page from disk.
//
// Entirely best-effort: if the fetch fails the run continues on fallback fonts
// and says so, rather than failing a screenshot run over a webfont.
// ---------------------------------------------------------------------------

const FONT_CACHE_DIR = join(tmpdir(), "abtn-screenshot-fonts");
const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
/** A desktop Chrome UA, so Google serves woff2 rather than a legacy format. */
const FONT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** curl rather than fetch: it already trusts this environment's proxy and CA. */
function curlBuffer(url, extraArgs = []) {
  const res = spawnSync("curl", ["-sSL", "--max-time", "25", "-A", FONT_UA, ...extraArgs, url], {
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout || res.stdout.length === 0) return null;
  return res.stdout;
}

function cachedOrFetch(name, url) {
  const file = join(FONT_CACHE_DIR, name);
  if (existsSync(file) && statSync(file).size > 0) return readFileSync(file);
  const buf = curlBuffer(url);
  if (!buf) return null;
  writeFileSync(file, buf);
  return buf;
}

async function installFontRoutes(context) {
  // The app no longer loads anything from Google Fonts: Archivo is self-hosted
  // out of public/fonts and served by the dev server like any other asset, so
  // the page's typography is already correct without help. Everything below is
  // kept because it is the only thing that would rescue a run if a webfont ever
  // returns to the head, but it must not run today: fetching Inter costs ten
  // seconds and caches a face the app does not use.
  void context;
  return;
  mkdirSync(FONT_CACHE_DIR, { recursive: true });
  const css = cachedOrFetch("inter.css", FONT_CSS_URL);
  if (!css) {
    log("WARNING: could not fetch Inter from Google Fonts — screenshots will use fallback fonts.");
    return false;
  }
  const cssText = css.toString("utf8");
  const urls = [...cssText.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(
    (m) => m[1],
  );
  const files = new Map();
  for (const url of urls) {
    const name = url.split("/").pop().split("?")[0];
    const buf = cachedOrFetch(name, url);
    if (buf) files.set(url, buf);
  }
  if (files.size === 0) {
    log("WARNING: Inter stylesheet fetched but no font files — using fallback fonts.");
    return false;
  }

  await context.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: cssText }),
  );
  await context.route("https://fonts.gstatic.com/**", (route) => {
    const body = files.get(route.request().url());
    if (!body) return route.abort();
    return route.fulfill({ status: 200, contentType: "font/woff2", body });
  });
  log(`Serving Inter locally (${files.size} font files cached in ${FONT_CACHE_DIR}).`);
  return true;
}

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

const captured = [];
const skipped = [];
const duplicates = [];
let pageErrors = [];

function log(msg) {
  process.stdout.write(`[screenshots] ${msg}\n`);
}

function wanted(name) {
  return !ONLY || name.includes(ONLY);
}

async function settle(page, ms = 450) {
  // The app fades every section in on mount; without this the first frames of
  // anim-fade-up are what lands in the PNG.
  await page.waitForTimeout(ms);
}

/**
 * Waits for React to actually hydrate, not merely for SSR HTML to be present.
 *
 * This is not paranoia: the whole page renders server-side with no event
 * handlers attached, so a file input filled (or a button clicked) before
 * hydration silently does nothing and the run fails somewhere far away from the
 * real cause. React tags every host node it hydrates with a `__reactFiber$…`
 * property, which is the earliest reliable client-side signal available.
 */
async function waitForHydration(page) {
  await page.waitForSelector('nav[aria-label="Primary"]', { timeout: 45_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('nav[aria-label="Primary"]');
      return (
        !!el &&
        Object.keys(el).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"))
      );
    },
    null,
    { timeout: 45_000 },
  );
  // Webfonts swap in after first paint; screenshotting before they land gives a
  // DejaVu-rendered page that looks nothing like the product.
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/** Fails loudly rather than quietly saving a picture of a crash. */
async function assertNoErrorOverlay(page, name) {
  const overlay = await page.locator("vite-error-overlay").count();
  if (overlay > 0) {
    const text = await page
      .locator("vite-error-overlay")
      .first()
      .innerText()
      .catch(() => "");
    throw new Error(`Vite error overlay is covering the page at "${name}":\n${text.slice(0, 800)}`);
  }
}

async function shot(page, name) {
  if (!wanted(name)) {
    skipped.push(name);
    return;
  }
  await assertNoErrorOverlay(page, name);
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const { size } = statSync(file);
  if (size < MIN_PNG_BYTES) {
    throw new Error(
      `Screenshot "${name}" is only ${size} bytes — the page almost certainly rendered blank. ` +
        `Check ${file}.`,
    );
  }
  // A byte-identical repeat means a click or a scroll did not take effect and
  // the "new" state was never actually reached — worth knowing about, since the
  // file itself looks perfectly healthy.
  const hash = createHash("sha1").update(readFileSync(file)).digest("hex");
  const twin = captured.find((c) => c.hash === hash);
  if (twin) duplicates.push(`${name} is byte-identical to ${twin.name}`);
  captured.push({ name, size, hash });
  log(`captured ${name}.png (${(size / 1024).toFixed(0)} KB)`);
}

/** The app is a fixed-height shell; the scroller is <main>, not the document. */
async function scrollMain(page, top) {
  await page
    .locator("main")
    .first()
    .evaluate((el, y) => {
      el.scrollTop = y;
    }, top);
  await page.waitForTimeout(250);
}

/** Puts an element at the top of the scroller. Unlike scrollIntoViewIfNeeded,
 * this always scrolls, so a section that is already half-visible still gets its
 * own framed screenshot instead of silently duplicating the previous one. */
async function scrollToTop(page, locator) {
  await locator.first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
}

async function gotoTab(page, path, readySelector) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  if (readySelector) await page.waitForSelector(readySelector, { timeout: 30_000 });
  await settle(page, 600);
}

/**
 * Seeds by driving Settings -> Import backup with an in-memory file, then
 * confirming. Deliberately the app's own validated path (parseBackup ->
 * importData -> replaceAllData) rather than a hand-written IndexedDB poke, so
 * the harness cannot drift from the schema the app actually accepts.
 */
async function importBackup(page, backup, label) {
  log(`Seeding: ${label}`);
  await gotoTab(page, "/settings", "text=Import backup");
  const file = {
    name: "seed-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup, null, 2)),
  };
  const confirm = page.getByRole("button", { name: "Replace all data" });

  // Retried because the change handler only exists once React has hydrated, and
  // a first cold Vite load can finish painting well before that happens. A
  // silently-ignored file selection is the failure mode this guards against.
  let selected = false;
  for (let attempt = 1; attempt <= 5 && !selected; attempt++) {
    await page.locator('input[type="file"]').setInputFiles(file);
    try {
      await confirm.waitFor({ state: "visible", timeout: 5_000 });
      selected = true;
    } catch {
      const err = await page
        .locator(".text-destructive")
        .allInnerTexts()
        .catch(() => []);
      const parseError = err.find((t) => t && /backup|file|json|malformed/i.test(t));
      if (parseError) {
        throw new Error(`The app rejected the generated backup JSON: ${parseError}`);
      }
      log(`  import file input did not register (attempt ${attempt}/5), retrying...`);
      await settle(page, 1000);
    }
  }
  if (!selected) {
    throw new Error(
      "Import confirmation never appeared. The Settings file input did not accept the seed file.",
    );
  }

  await confirm.click();
  await page.waitForSelector("text=Backup imported.", { timeout: 20_000 });
  // Reload so every screen that follows is rendering a real IndexedDB hydrate,
  // not the in-memory state importData happened to leave behind.
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await settle(page, 600);
}

// ---------------------------------------------------------------------------
// The capture plan
// ---------------------------------------------------------------------------

async function captureEmptyStates(page) {
  await importBackup(page, buildEmptyBackup(), "empty / fresh install");

  await gotoTab(page, "/", '[data-testid="timeline-scroll-container"]');
  await shot(page, "01-empty-today");

  await gotoTab(page, "/history", 'h1:text("History")');
  await shot(page, "02-empty-history-weekly");

  await page.getByRole("button", { name: "Calendar" }).click();
  await settle(page);
  await shot(page, "03-empty-history-calendar");

  await gotoTab(page, "/charts", 'h1:text("Charts")');
  await shot(page, "04-empty-charts");

  await gotoTab(page, "/", '[data-testid="timeline-scroll-container"]');
  await page.getByRole("button", { name: /Edit daily numbers/ }).click();
  await settle(page, 600);
  await shot(page, "05-empty-day-editor-sheet");
}

async function captureToday(page) {
  await gotoTab(page, "/", '[data-testid="timeline-scroll-container"]');
  await page.waitForSelector("text=Habits", { timeout: 15_000 });
  await shot(page, "10-today-populated");

  await scrollMain(page, 400);
  await shot(page, "11-today-populated-scrolled");

  await scrollMain(page, 0);
  // The daily-numbers card is a button wrapping the ring + macro columns.
  await page.locator("section", { hasText: "Daily numbers" }).getByRole("button").first().click();
  await settle(page, 600);
  await shot(page, "12-today-day-editor-sheet");
  await page.keyboard.press("Escape");
  await settle(page);

  // Backfilling an older day from the week strip, which is the other way in to
  // the same sheet. The old consistency strip labelled its days "Log for ...";
  // WeekStrip labels them with the full date.
  await page.getByRole("button", { name: "Monday, August 17, 2026" }).click();
  await settle(page);
  await page.getByRole("button", { name: /Edit daily numbers/ }).click();
  await settle(page, 600);
  await shot(page, "13-day-editor-backfill-older-day");
  await page.keyboard.press("Escape");
  await settle(page);
}

async function captureTargetsOff(page) {
  await gotoTab(page, "/settings", "text=Daily targets");
  await page.getByRole("switch", { name: "Daily targets" }).click();
  await settle(page);
  await gotoTab(page, "/", '[data-testid="timeline-scroll-container"]');
  await shot(page, "14-today-targets-off-macro-ring");
  await gotoTab(page, "/settings", "text=Daily targets");
  await page.getByRole("switch", { name: "Daily targets" }).click();
  await settle(page);
}

async function captureHistory(page) {
  await gotoTab(page, "/history", 'h1:text("History")');
  await shot(page, "20-history-weekly");
  await scrollMain(page, 700);
  await shot(page, "21-history-weekly-scrolled");
  await scrollMain(page, 0);

  await page.getByRole("button", { name: "Calendar" }).click();
  await settle(page, 600);
  await shot(page, "22-history-calendar");
  await scrollMain(page, 500);
  await shot(page, "23-history-calendar-scrolled");
}

async function captureCharts(page) {
  const metrics = ["Calories", "Protein", "Carbs", "Fat", "Steps", "Bodyweight"];
  await gotoTab(page, "/charts", 'h1:text("Charts")');

  for (const [i, metric] of metrics.entries()) {
    await page.getByRole("group", { name: "Metric" }).getByRole("button", { name: metric }).click();
    await settle(page, 400);
    await shot(page, `3${i}-charts-${metric.toLowerCase()}-30d`);
  }

  // Range chips, on Calories.
  await page
    .getByRole("group", { name: "Metric" })
    .getByRole("button", { name: "Calories" })
    .click();
  await settle(page, 300);
  for (const [label, name] of [
    ["Last 7 days", "36-charts-calories-7d"],
    ["Last 90 days", "37-charts-calories-90d"],
    ["All time", "38-charts-calories-all"],
  ]) {
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: label })
      .click();
    await settle(page, 400);
    await shot(page, name);
  }

  // The smoothed series, on the metric where it actually matters.
  await page
    .getByRole("group", { name: "Metric" })
    .getByRole("button", { name: "Bodyweight" })
    .click();
  await page
    .getByRole("group", { name: "Date range" })
    .getByRole("button", { name: "Last 90 days" })
    .click();
  await page
    .getByRole("group", { name: "Series" })
    .getByRole("button", { name: "7-day avg" })
    .click();
  await settle(page, 500);
  // Everything Charts has (chips, plot, trend line, the four stat tiles) fits
  // one viewport, so there is deliberately no below-the-fold capture here.
  await shot(page, "39-charts-bodyweight-7day-avg");
}

async function captureSettings(page) {
  await gotoTab(page, "/settings", 'h1:text("Settings")');
  await shot(page, "40-settings-top");

  // The seed uses two profiles across an uneven week, so the editor is already
  // in its full mode: goals, the seven-day assignment strip and the profiles.
  await scrollToTop(page, page.getByText("Daily targets", { exact: true }));
  await shot(page, "41-settings-targets-editor");

  const dayAssignments = page.getByText("Day assignments", { exact: true });
  if (await dayAssignments.count()) {
    await scrollToTop(page, dayAssignments);
    await shot(page, "42-settings-targets-weekday-assignment");
  }

  await scrollToTop(page, page.getByText("Target profiles", { exact: true }));
  await shot(page, "43-settings-target-profile-cards");

  // Scrolling Export backup to the top also lands the page on its last screen,
  // so this doubles as the settings-bottom capture.
  await scrollToTop(page, page.getByText("Export backup", { exact: true }));
  await shot(page, "44-settings-data-backup-and-reset");
}

async function captureWorkoutFlow(page) {
  await gotoTab(page, "/", '[data-testid="timeline-scroll-container"]');

  await page.getByRole("button", { name: "Start workout" }).click();
  await settle(page, 500);
  await shot(page, "50-workout-chooser-sheet");

  await page.getByRole("button", { name: "Log cardio workout" }).click();
  await settle(page, 500);
  await shot(page, "51-cardio-log-card");
  await page.keyboard.press("Escape");
  await settle(page, 300);

  await page.getByRole("button", { name: "Start workout" }).click();
  await settle(page, 400);
  await page.getByRole("button", { name: "Log strength training workout" }).click();
  await settle(page, 500);
  await shot(page, "52-start-workout-sheet");

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForSelector("text=Time between sets", { timeout: 15_000 });
  await settle(page, 600);
  await shot(page, "53-workout-active-empty");

  await page.getByRole("button", { name: "Log a set" }).click();
  await settle(page, 600);
  await shot(page, "54-log-set-exercise-picker");

  await page.getByPlaceholder("Search or add exercise").fill("bench");
  await settle(page, 300);
  await shot(page, "55-log-set-exercise-search");

  await page
    .getByRole("button", { name: /^Bench Press/ })
    .first()
    .click();
  await settle(page, 500);
  await shot(page, "56-log-set-sheet");

  await page.getByLabel("Weight", { exact: true }).fill("225");
  await page.getByLabel("Reps", { exact: true }).fill("5");
  await page.getByLabel("Increase sets").click();
  await page.getByLabel("Increase sets").click();
  await settle(page, 300);
  await shot(page, "57-log-set-sheet-filled");

  await page.getByRole("button", { name: /^Log set 1 of 3$/ }).click();
  await page.waitForSelector("text=Next set", { timeout: 15_000 });
  await settle(page, 500);
  await shot(page, "58-workout-active-in-block");

  await page.getByRole("button", { name: "View workout" }).click();
  await settle(page, 600);
  await shot(page, "59-workout-session-view");
  await page.getByRole("button", { name: "Done" }).click();
  await settle(page, 300);

  // The in-progress banner is a state every other tab renders, so grab it once.
  await page.getByRole("button", { name: "Home" }).click();
  await page.waitForSelector("text=Workout in progress", { timeout: 15_000 });
  await settle(page, 500);
  await shot(page, "5a-today-with-active-session-banner");

  // Ending a workout lands on its summary now, so the flow finishes there.
  await page.getByRole("button", { name: /Return to active workout/ }).click();
  await page.waitForSelector("text=Time between sets", { timeout: 15_000 });
  // 225x5 does not beat the seeded history (the heavy bench block finishes its
  // sixth week at 230), so this is deliberately the no-records summary: the
  // volume moved leads, and the app says nothing it has not earned.
  await endWorkoutAt(page, 47);
  await page.waitForSelector("text=Finished", { timeout: 15_000 });
  await settle(page, 600);
  await shot(page, "5b-workout-summary-no-records");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForSelector('[data-testid="timeline-scroll-container"]', { timeout: 15_000 });
  await settle(page, 500);

  // The same screen when the workout beat something. Two records, so the
  // headline and the group of everything else are both in the picture.
  await startWorkout(page);
  await logOneSet(page, "Bench Press", 275, 3);
  await logOneSet(page, "Back Squat", 315, 5);
  await endWorkoutAt(page, 62);
  await page.waitForSelector("text=Personal record", { timeout: 15_000 });
  await settle(page, 600);
  await shot(page, "5c-workout-summary-record");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForSelector('[data-testid="timeline-scroll-container"]', { timeout: 15_000 });
  await settle(page, 500);

  // An empty workout has no summary: ending one is a cancel, and it goes
  // straight home the way it always did. Asserted rather than photographed,
  // since the picture is just the Today screen.
  await startWorkout(page);
  await endWorkoutAt(page, 3);
  await page.waitForSelector('[data-testid="timeline-scroll-container"]', { timeout: 15_000 });
  if (await page.locator("text=Finished").count()) {
    throw new Error("Ending a workout with nothing logged should not show a summary.");
  }
  await settle(page, 400);
}

/** Start workout -> strength -> Start, landing on the live workout screen. */
async function startWorkout(page) {
  await page.getByRole("button", { name: "Start workout" }).click();
  await settle(page, 400);
  await page.getByRole("button", { name: "Log strength training workout" }).click();
  await settle(page, 500);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForSelector("text=Time between sets", { timeout: 15_000 });
  await settle(page, 400);
}

/** One set of one exercise, choosing the exercise even when the sheet
 * remembers the last one. */
async function logOneSet(page, exercise, weight, reps) {
  await page.getByRole("button", { name: /Log a set|Log the next set/ }).click();
  await settle(page, 600);
  const change = page.getByRole("button", { name: "Change" });
  if (await change.count()) {
    await change.click();
    await settle(page, 400);
  }
  await page.getByPlaceholder("Search or add exercise").fill(exercise);
  await settle(page, 300);
  await page
    .getByRole("button", { name: new RegExp(`^${exercise}`) })
    .first()
    .click();
  await settle(page, 500);
  await page.getByLabel("Weight", { exact: true }).fill(String(weight));
  await page.getByLabel("Reps", { exact: true }).fill(String(reps));
  await settle(page, 200);
  await page.getByRole("button", { name: /^Log set/ }).click();
  await settle(page, 700);
}

/**
 * Ends the workout `minutes` after the frozen instant it started at, then puts
 * the clock straight back.
 *
 * The run's clock is fixed, so a workout started and ended inside the same
 * instant reports no duration at all, and the summary would be photographed
 * without the row every real one has. Nudging only for the End press keeps the
 * shot representative while every other screen stays seeded from FROZEN_NOW.
 */
async function endWorkoutAt(page, minutes) {
  const context = page.context();
  await context.clock.setFixedTime(new Date(FROZEN_NOW.getTime() + minutes * 60_000));
  await page.getByRole("button", { name: "End", exact: true }).click();
  await settle(page, 400);
  await context.clock.setFixedTime(FROZEN_NOW);
}

async function captureSessionDetail(page) {
  await gotoTab(page, "/", '[data-testid="timeline-scroll-container"]');
  await scrollMain(page, 99_999);
  const sessionRow = page.locator("section", { hasText: "Workouts" }).getByRole("button").first();
  if (await sessionRow.count()) {
    await sessionRow.click();
    await page.waitForTimeout(900);
    await shot(page, "60-session-detail");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (existsSync(OUT_DIR)) {
    // A full run wipes the directory so deleted screens cannot linger as stale
    // PNGs. A FILTERED run must not: SCREENSHOT_ONLY is documented as a filter,
    // and clearing everything made it a filter that deletes the 35 screens it
    // was told to skip. Since screenshots/ is gitignored, that silently
    // destroyed the before half of a before/after comparison, which is most of
    // what this harness exists for.
    if (!ONLY) {
      for (const f of readdirSync(OUT_DIR)) {
        if (f.endsWith(".png")) rmSync(join(OUT_DIR, f));
      }
    }
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  const server = await startDevServer();
  let browser;
  try {
    browser = await chromium.launch({
      headless: !HEADED,
      // The pinned browser in this image; falls back to Playwright's own
      // resolution when it is not there.
      ...(existsSync("/opt/pw-browsers/chromium")
        ? { executablePath: "/opt/pw-browsers/chromium" }
        : {}),
    });

    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      // UTC so the seed's day keys and the app's local `dayKey` agree no matter
      // where this runs.
      timezoneId: "UTC",
      locale: "en-US",
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    // Pin the clock: seeded dates are all relative to this instant, so the same
    // data lands on the same calendar cells on every run.
    await context.clock.setFixedTime(FROZEN_NOW);
    await installFontRoutes(context);

    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    await captureEmptyStates(page);
    await importBackup(page, buildFullBackup(), "six weeks of populated history");
    await captureToday(page);
    await captureTargetsOff(page);
    await captureHistory(page);
    await captureCharts(page);
    await captureSettings(page);
    await captureWorkoutFlow(page);
    await captureSessionDetail(page);

    await context.close();
    await browser.close();
    browser = undefined;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill("SIGTERM");
    throw err;
  } finally {
    if (server) server.kill("SIGTERM");
  }

  if (captured.length === 0) {
    throw new Error("No screenshots were captured. Check SCREENSHOT_ONLY.");
  }
  log(`Wrote ${captured.length} screenshots to ${OUT_DIR}`);
  if (skipped.length) log(`Skipped ${skipped.length} (SCREENSHOT_ONLY=${ONLY})`);
  if (duplicates.length) {
    log(`WARNING: ${duplicates.length} screenshots captured an unchanged screen:`);
    for (const d of duplicates) log(`  - ${d}`);
  }
  const noisy = pageErrors.filter(
    (e) => !/favicon|manifest|service worker|Download the React DevTools/i.test(e),
  );
  if (noisy.length) {
    log(`Note: ${noisy.length} console/page errors were seen during the run:`);
    for (const e of noisy.slice(0, 10)) log(`  - ${e.slice(0, 200)}`);
  }
}

main().catch((err) => {
  console.error(`\n[screenshots] FAILED: ${err && err.message ? err.message : err}`);
  if (err && err.stack) console.error(err.stack.split("\n").slice(1, 6).join("\n"));
  process.exit(1);
});
