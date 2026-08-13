import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

// This file deliberately has NO beforeEach that touches `db`: the whole point
// is to create a version-1 database FIRST, before the app's current instance
// has ever opened it. fake-indexeddb/auto (src/test/setup.ts) gives each test
// file its own empty IndexedDB, so this starts from nothing.

/**
 * The schema version db.ts declares today, written out by hand rather than read
 * off `db.verno`.
 *
 * Reading it from `db` would make the assertion below unfalsifiable. Dexie sets
 * `verno` from the `version()` calls at construction time, not from what is on
 * disk, so `expect(db.verno).toBe(db.verno)` would pass however badly the
 * upgrade had gone. Having to bump this by hand is the feature: a schema bump is
 * precisely the moment someone should re-read this test and decide whether the
 * tables the new version adds also need covering here.
 *
 * The assertions that survive a bump on their own are the ones below about what
 * actually landed on disk and what the store hydrated to. Those are the test's
 * real subject; this constant is just the canary.
 */
const CURRENT_SCHEMA_VERSION = 3;

/** Every table the app expects to exist once an old database has been upgraded. */
const TABLES_ADDED_AFTER_V1 = ["dailyLogs", "habits", "habitEntries"] as const;

describe("Dexie v1 -> current schema upgrade", () => {
  it("opens an existing v1 database, upgrades it in place, and keeps the workout data", async () => {
    // The exact v1 schema, under the same database name the app uses.
    const v1 = new Dexie("workout-tracker");
    v1.version(1).stores({
      exercises: "id",
      slots: "id",
      sessions: "id",
      sets: "id, sessionId",
      meta: "key",
    });
    await v1.open();
    expect(v1.verno).toBe(1);
    // If any later table already existed here, the rest of this test would be
    // measuring nothing: there would be no upgrade left to perform. Read off the
    // real IDBDatabase rather than `v1.tables` so the before and after
    // observations are the same kind of claim, about disk and not declarations.
    const storesBefore = Array.from(v1.backendDB().objectStoreNames);
    for (const name of TABLES_ADDED_AFTER_V1) {
      expect(storesBefore).not.toContain(name);
    }

    await v1.table("exercises").put({ id: "e1", name: "Bench Press", type: "main" });
    await v1.table("slots").put({ id: "s1", name: "Heavy Bench", rotationOrder: 0 });
    await v1.table("sessions").put({ id: "sess1", splitSlotId: "s1", startedAt: 1000 });
    await v1
      .table("sets")
      .put({ id: "set1", sessionId: "sess1", exerciseId: "e1", weight: 225, reps: 5, loggedAt: 1 });
    // chartsEnabled: false is not the default, so it doubles as a marker: if the
    // upgrade ever replaced the settings record instead of carrying it forward,
    // this would silently come back true.
    await v1.table("meta").put({ key: "settings", unit: "kg", chartsEnabled: false });
    v1.close();

    // The app opens the same database at its current version. Every bump so far
    // only ADDS tables, and adding a table needs no data migration, so this must
    // not throw and must not touch existing rows.
    await db.open();
    expect(db.verno).toBe(CURRENT_SCHEMA_VERSION);

    // `db.tables` reflects only what db.ts DECLARED, so it would list these even
    // if the upgrade transaction had never run. `backendDB()` is the real
    // IDBDatabase Dexie is holding, so its objectStoreNames are the stores that
    // genuinely exist on disk now. This is the assertion that keeps meaning
    // something after the next version bump.
    const persistedStores = Array.from(db.backendDB().objectStoreNames);
    for (const name of TABLES_ADDED_AFTER_V1) {
      expect(persistedStores).toContain(name);
    }

    // The v1 rows survived the upgrade untouched.
    expect(await db.exercises.get("e1")).toMatchObject({ name: "Bench Press" });
    expect(await db.slots.count()).toBe(1);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.sets.count()).toBe(1);
    expect(await db.meta.get("settings")).toMatchObject({ unit: "kg", chartsEnabled: false });

    // Each new table exists, is empty, and is writable. Writing matters as much
    // as counting: an object store created without its declared indexes still
    // reports a count of 0, so an empty read alone would not catch it.
    expect(await db.dailyLogs.count()).toBe(0);
    await db.dailyLogs.put({ date: "2026-08-07", calories: 2400 });
    expect(await db.dailyLogs.get("2026-08-07")).toMatchObject({ calories: 2400 });

    expect(await db.habits.count()).toBe(0);
    await db.habits.put({ id: "h1", name: "Creatine", order: 0 });
    await db.habitEntries.put({ id: "2026-08-07|h1", date: "2026-08-07", habitId: "h1" });
    // Queried through the indexes v3 declared on habitEntries, which is the only
    // way to prove they were actually created rather than merely declared: Today
    // reads a whole day at once, and deleting a habit sweeps by habitId.
    expect(await db.habitEntries.where("date").equals("2026-08-07").count()).toBe(1);
    expect(await db.habitEntries.where("habitId").equals("h1").count()).toBe(1);

    // And an upgraded DB hydrates as an existing install, not a first run.
    await useStore.getState().hydrate();
    const state = useStore.getState();
    expect(state.exercises).toHaveLength(1); // no demo re-seed
    expect(state.unit).toBe("kg");
    expect(state.chartsEnabled).toBe(false); // the v1 settings record, not defaults
    expect(state.dailyLogs).toEqual([{ date: "2026-08-07", calories: 2400 }]);
    expect(state.habits).toEqual([{ id: "h1", name: "Creatine", order: 0 }]);
    expect(state.habitEntries).toEqual([
      { id: "2026-08-07|h1", date: "2026-08-07", habitId: "h1" },
    ]);
    // A v1 settings record predates targets entirely, so it carries no profiles.
    // loadAll backfills them on read, which is what stops an upgraded install
    // from landing on a profile-less targets editor if the user enables it.
    expect(state.targetProfiles).toHaveLength(1);
    expect(state.weekdayTargets).toHaveLength(7);
    expect(new Set(state.weekdayTargets)).toEqual(new Set([state.targetProfiles[0].id]));
    // The toggles those features hang off stay off: an upgrade must not turn on
    // a surface the user never asked for.
    expect(state.targetsEnabled).toBe(false);
    expect(state.habitsEnabled).toBe(false);
    expect(state.toolsEnabled).toBe(false);
  });
});
