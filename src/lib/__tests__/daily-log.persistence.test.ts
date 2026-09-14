import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

// fake-indexeddb/auto (loaded globally in src/test/setup.ts) gives us a real
// IndexedDB implementation backed by memory, so these exercise Dexie's actual
// read/write paths rather than a mock.

const DEFAULT_STATE = {
  unit: "lbs" as const,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,
  hydrated: false,
};

// Clears every table the current schema has, including the two nothing in this
// file writes: a reset that misses a table leaks rows into the next test, and
// "nothing writes it yet" is exactly the assumption that rots when a new test
// arrives.
async function resetDb() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.dailyLogs.clear(),
    db.meta.clear(),
  ]);
}

/** Store write-through is fire-and-forget; give pending IndexedDB requests a tick to land. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/** Simulates a force-quit and reopen: fresh in-memory state, same DB. */
async function reload() {
  useStore.setState({ ...DEFAULT_STATE, hydrated: false });
  await useStore.getState().hydrate();
}

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE });
});

describe("daily logs (schema + write-through)", () => {
  it("opens the current schema with an empty dailyLogs table and seeds no logs", async () => {
    await useStore.getState().hydrate();

    // Hardcoded rather than read off `db`, for the reason spelled out in
    // db.upgrade.test.ts: Dexie sets `verno` from the version() declarations, so
    // comparing it against itself could never fail. Bump it by hand, and when
    // you do, check that a new table has not quietly started out non-empty.
    expect(db.verno).toBe(7);
    // The check the comment above asks for: v7 added `coachClients`, and a new
    // table starting out with rows in it would mean a migration wrote there.
    expect(await db.coachClients.count()).toBe(0);
    // The store and the DB have to agree. Checking only the store would pass if
    // hydrate had invented an empty array over a table that actually had rows.
    expect(useStore.getState().dailyLogs).toEqual([]);
    expect(await db.dailyLogs.count()).toBe(0);
    // Meanwhile the tables that DO get seeded were seeded, so "empty" above is a
    // statement about dailyLogs specifically and not about a seed that failed
    // wholesale and left every table bare.
    expect(useStore.getState().exercises.length).toBeGreaterThan(100);
  });

  it("survives a force-quit and reopen", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", {
      calories: 2450,
      protein: 195,
      carbs: 240,
      fat: 70,
      steps: 9421,
      bodyweight: 186.5,
      isUntracked: true,
    });
    await flush();

    await reload();

    expect(useStore.getState().dailyLogFor("2026-08-07")).toEqual({
      date: "2026-08-07",
      calories: 2450,
      protein: 195,
      carbs: 240,
      fat: 70,
      steps: 9421,
      bodyweight: 186.5,
      isUntracked: true,
    });
  });

  it("persists a 0 as a real value rather than dropping it", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { steps: 0 });
    await flush();

    await reload();

    expect(useStore.getState().dailyLogFor("2026-08-07")).toMatchObject({ steps: 0 });
  });

  it("merges a partial patch into an existing record instead of replacing it", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { calories: 2400, protein: 180 });
    useStore.getState().upsertDailyLog("2026-08-07", { steps: 7000 });
    await flush();

    expect(useStore.getState().dailyLogFor("2026-08-07")).toMatchObject({
      calories: 2400,
      protein: 180,
      steps: 7000,
    });
    // One row per calendar day, not one per edit.
    expect(useStore.getState().dailyLogs.filter((l) => l.date === "2026-08-07")).toHaveLength(1);

    await reload();
    expect(useStore.getState().dailyLogFor("2026-08-07")).toMatchObject({
      calories: 2400,
      protein: 180,
      steps: 7000,
    });
  });

  it("overwrites a field when the patch names it, and unsets it when the patch passes undefined", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { calories: 2400, protein: 180 });
    useStore.getState().upsertDailyLog("2026-08-07", { calories: 2600, protein: undefined });
    await flush();

    await reload();
    const log = useStore.getState().dailyLogFor("2026-08-07");
    expect(log?.calories).toBe(2600);
    expect(log?.protein).toBeUndefined();
  });

  it("deletes the record instead of storing an empty shell when every field is cleared", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { calories: 2400, steps: 9000 });
    await flush();
    expect(await db.dailyLogs.count()).toBe(1);

    // Exactly what the editor sends when the user blanks every input.
    useStore.getState().upsertDailyLog("2026-08-07", {
      calories: undefined,
      protein: undefined,
      carbs: undefined,
      fat: undefined,
      steps: undefined,
      bodyweight: undefined,
      isUntracked: undefined,
    });
    await flush();

    expect(useStore.getState().dailyLogFor("2026-08-07")).toBeUndefined();
    expect(await db.dailyLogs.count()).toBe(0);

    await reload();
    expect(useStore.getState().dailyLogs).toEqual([]);
  });

  it("does not create a record when an upsert on a fresh day is empty", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { calories: undefined, isUntracked: false });
    await flush();

    expect(useStore.getState().dailyLogs).toEqual([]);
    expect(await db.dailyLogs.count()).toBe(0);
  });

  it("keeps a untracked-day-only record alive with no numbers at all", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { isUntracked: true });
    await flush();

    await reload();
    expect(useStore.getState().dailyLogFor("2026-08-07")).toEqual({
      date: "2026-08-07",
      isUntracked: true,
    });
  });

  it("keeps days independent of one another", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-06", { calories: 2000 });
    useStore.getState().upsertDailyLog("2026-08-07", { calories: 2500 });
    await flush();

    await reload();
    expect(useStore.getState().dailyLogFor("2026-08-06")).toMatchObject({ calories: 2000 });
    expect(useStore.getState().dailyLogFor("2026-08-07")).toMatchObject({ calories: 2500 });
    expect(useStore.getState().dailyLogs).toHaveLength(2);
  });

  it("persists deleteDailyLog across a reload", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { calories: 2400 });
    await flush();
    useStore.getState().deleteDailyLog("2026-08-07");
    await flush();

    await reload();
    expect(useStore.getState().dailyLogFor("2026-08-07")).toBeUndefined();
    expect(await db.dailyLogs.count()).toBe(0);
  });

  it("clearAllData wipes daily logs", async () => {
    await useStore.getState().hydrate();
    useStore.getState().upsertDailyLog("2026-08-07", { calories: 2400 });
    await flush();

    await useStore.getState().clearAllData();

    expect(useStore.getState().dailyLogs).toEqual([]);
    expect(await db.dailyLogs.count()).toBe(0);
  });
});
