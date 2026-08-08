import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

// This file deliberately has NO beforeEach that touches `db`: the whole point
// is to create a version-1 database FIRST, before the app's v2 instance has
// ever opened it. fake-indexeddb/auto (src/test/setup.ts) gives each test file
// its own empty IndexedDB, so this starts from nothing.

describe("Dexie v1 -> v2 upgrade", () => {
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
    expect(v1.tables.map((t) => t.name)).not.toContain("dailyLogs");

    await v1.table("exercises").put({ id: "e1", name: "Bench Press", type: "main" });
    await v1.table("slots").put({ id: "s1", name: "Heavy Bench", rotationOrder: 0 });
    await v1.table("sessions").put({ id: "sess1", splitSlotId: "s1", startedAt: 1000 });
    await v1
      .table("sets")
      .put({ id: "set1", sessionId: "sess1", exerciseId: "e1", weight: 225, reps: 5, loggedAt: 1 });
    await v1.table("meta").put({ key: "settings", unit: "kg", chartsEnabled: false });
    v1.close();

    // The app opens the same database at v2. Adding a table needs no data
    // migration, so this must not throw and must not touch existing rows.
    await db.open();
    expect(db.verno).toBe(2);

    expect(await db.exercises.get("e1")).toMatchObject({ name: "Bench Press" });
    expect(await db.slots.count()).toBe(1);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.sets.count()).toBe(1);
    expect(await db.meta.get("settings")).toMatchObject({ unit: "kg" });

    // The new table exists, is empty, and is writable.
    expect(await db.dailyLogs.count()).toBe(0);
    await db.dailyLogs.put({ date: "2026-08-07", calories: 2400 });
    expect(await db.dailyLogs.get("2026-08-07")).toMatchObject({ calories: 2400 });

    // And an upgraded DB hydrates as an existing install, not a first run.
    await useStore.getState().hydrate();
    const state = useStore.getState();
    expect(state.exercises).toHaveLength(1); // no demo re-seed
    expect(state.unit).toBe("kg");
    expect(state.dailyLogs).toEqual([{ date: "2026-08-07", calories: 2400 }]);
  });
});
