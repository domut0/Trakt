import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  dbReadOnlyReason,
  defaultSettings,
  replaceAllData,
  safeWrite,
  seedDb,
  setDbReadOnly,
} from "../db";
import { useStore } from "../store";
import type { BackupData } from "../store";

/**
 * The read-only latch, which is coach mode's one structural guarantee.
 *
 * Coach mode swaps the store's arrays for a client's data so that Today, Charts
 * and History render it unmodified. Every store action still writes through to
 * THIS device's IndexedDB, so without the latch a single action reaching a
 * disabled control would file a client's numbers in the coach's own log.
 *
 * These tests drive the real store actions against a real (fake-indexeddb)
 * database rather than asserting on a mock, because the thing being proven is
 * that nothing lands on disk -- and a mock would only prove that nothing reached
 * the mock.
 *
 * The action list below is deliberately exhaustive over the mutating surface. A
 * new action added without a line here is exactly the regression this file
 * exists to catch, so it is worth keeping in sync.
 */

/** Store write-through is fire-and-forget; give pending requests a tick to land. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

async function tableCounts() {
  const [exercises, slots, sessions, sets, dailyLogs, nutritionPhases, plannedDays, meta] =
    await Promise.all([
      db.exercises.count(),
      db.slots.count(),
      db.sessions.count(),
      db.sets.count(),
      db.dailyLogs.count(),
      db.nutritionPhases.count(),
      db.plannedDays.count(),
      db.meta.count(),
    ]);
  return { exercises, slots, sessions, sets, dailyLogs, nutritionPhases, plannedDays, meta };
}

async function resetDb() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.dailyLogs.clear(),
    db.nutritionPhases.clear(),
    db.plannedDays.clear(),
    db.meta.clear(),
  ]);
}

beforeEach(async () => {
  setDbReadOnly(undefined);
  await resetDb();
  useStore.setState({
    unit: "lbs",
    exercises: [],
    slots: [],
    sessions: [],
    sets: [],
    dailyLogs: [],
    nutritionPhases: [],
    plannedDays: [],
    activeSessionId: undefined,
    currentExerciseId: undefined,
    hydrated: true,
  });
});

afterEach(() => {
  setDbReadOnly(undefined);
});

describe("the read-only latch", () => {
  it("reports its reason, and clears", () => {
    expect(dbReadOnlyReason()).toBeUndefined();
    setDbReadOnly("viewing Bob");
    expect(dbReadOnlyReason()).toBe("viewing Bob");
    setDbReadOnly(undefined);
    expect(dbReadOnlyReason()).toBeUndefined();
  });

  it("stops safeWrite from running its operation at all", async () => {
    let ran = false;
    setDbReadOnly("viewing Bob");
    safeWrite(async () => {
      ran = true;
    });
    await flush();
    expect(ran).toBe(false);
  });

  it("still runs the operation when not latched", async () => {
    let ran = false;
    safeWrite(async () => {
      ran = true;
    });
    await flush();
    expect(ran).toBe(true);
  });
});

describe("mutating store actions under the latch", () => {
  // Each entry drives one action far enough to produce a durable write. They run
  // against an empty store, so several are no-ops on their own state -- what is
  // being asserted is only that nothing reaches IndexedDB.
  const actions: Array<[string, () => void]> = [
    ["addExercise", () => useStore.getState().addExercise("Bench Press", "main")],
    ["setUnit", () => useStore.getState().setUnit("kg")],
    [
      "upsertDailyLog",
      () => useStore.getState().upsertDailyLog("2026-09-14", { calories: 2400, steps: 10000 }),
    ],
    ["deleteDailyLog", () => useStore.getState().deleteDailyLog("2026-09-14")],
    [
      "startWorkout",
      () => {
        useStore.getState().addExercise("Squat", "main");
        useStore.getState().startWorkout("Lower");
      },
    ],
    [
      "logSet",
      () => {
        const ex = useStore.getState().addExercise("Deadlift", "main");
        useStore.getState().startWorkout("Pull");
        useStore.getState().logSet({ exerciseId: ex.id, weight: 225, reps: 5 });
      },
    ],
    [
      "logCardio",
      () => {
        const ex = useStore.getState().addExercise("Treadmill", "cardio");
        useStore.getState().logCardio({ exerciseId: ex.id, durationMinutes: 28 });
      },
    ],
  ];

  it.each(actions)("%s writes nothing to IndexedDB", async (_name, run) => {
    setDbReadOnly("viewing Bob");
    const before = await tableCounts();
    run();
    await flush();
    expect(await tableCounts()).toEqual(before);
  });

  it("the same actions DO write when the latch is off", async () => {
    // The control. Without it, every assertion above would also pass against a
    // latch that was permanently stuck on, or an action that never wrote at all.
    const before = await tableCounts();
    useStore.getState().addExercise("Overhead Press", "main");
    useStore.getState().upsertDailyLog("2026-09-14", { calories: 2400 });
    await flush();
    const after = await tableCounts();
    expect(after.exercises).toBeGreaterThan(before.exercises);
    expect(after.dailyLogs).toBeGreaterThan(before.dailyLogs);
  });
});

describe("destructive writes under the latch", () => {
  const backup: BackupData = {
    version: 4,
    unit: "lbs",
    exercises: [],
    slots: [],
    sessions: [],
    sets: [],
    dailyLogs: [],
    nutritionPhases: [],
    plannedDays: [],
    templates: [],
    nextSlotId: undefined,
  };

  // These throw rather than no-op: both are awaited by their callers and both
  // clear every table first, so a silent refusal would report a successful
  // restore that did nothing.
  it("replaceAllData throws instead of silently doing nothing", async () => {
    setDbReadOnly("viewing Bob");
    await expect(replaceAllData(backup)).rejects.toThrow(/read-only/);
  });

  it("seedDb throws instead of silently doing nothing", async () => {
    setDbReadOnly("viewing Bob");
    await expect(
      seedDb({
        exercises: [],
        slots: [],
        sessions: [],
        sets: [],
        settings: defaultSettings(),
      }),
    ).rejects.toThrow(/read-only/);
  });

  it("names the reason in the error, so a refusal is diagnosable", async () => {
    setDbReadOnly("viewing Bob");
    await expect(replaceAllData(backup)).rejects.toThrow(/viewing Bob/);
  });
});
