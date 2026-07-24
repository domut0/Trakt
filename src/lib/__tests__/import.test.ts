import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { parseBackup, useStore, type BackupData } from "../store";

// fake-indexeddb/auto (loaded globally in src/test/setup.ts) gives us a real
// IndexedDB implementation backed by memory, so the round-trip test below
// exercises Dexie's actual read/write paths, not a mock.

const DEFAULT_STATE = {
  unit: "lbs" as const,
  motivationEnabled: true,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,
  hydrated: false,
};

/** Order-insensitive comparison: Dexie's toArray() returns rows in primary-key
 * order, which need not match the order entities were originally created or
 * imported in. Content equality is what matters for a restore, not order. */
function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

async function resetDb() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.meta.clear(),
  ]);
}

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE });
});

const validBackup: BackupData = {
  exercises: [{ id: "e1", name: "Bench Press", type: "main" }],
  slots: [{ id: "s1", name: "Heavy Bench", rotationOrder: 0 }],
  sessions: [{ id: "sess1", splitSlotId: "s1", startedAt: 1000, endedAt: 2000 }],
  sets: [
    { id: "set1", sessionId: "sess1", exerciseId: "e1", weight: 225, reps: 5, loggedAt: 1500 },
  ],
  unit: "kg",
  motivationEnabled: false,
};

describe("parseBackup (validation)", () => {
  it("accepts a well-formed backup and returns it verbatim", () => {
    const result = parseBackup(JSON.stringify(validBackup));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(validBackup);
    }
  });

  it("rejects text that is not valid JSON", () => {
    const result = parseBackup("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/json/i);
  });

  it("rejects JSON that is not an object", () => {
    for (const text of ["[]", "42", '"hello"', "null"]) {
      const result = parseBackup(text);
      expect(result.ok).toBe(false);
    }
  });

  it.each(["exercises", "slots", "sessions", "sets"] as const)(
    "rejects a backup where %s is missing",
    (key) => {
      const broken: Record<string, unknown> = { ...validBackup };
      delete broken[key];
      const result = parseBackup(JSON.stringify(broken));
      expect(result.ok).toBe(false);
    },
  );

  it.each(["exercises", "slots", "sessions", "sets"] as const)(
    "rejects a backup where %s is not an array",
    (key) => {
      const broken = { ...validBackup, [key]: "not-an-array" };
      const result = parseBackup(JSON.stringify(broken));
      expect(result.ok).toBe(false);
    },
  );

  it("rejects a backup with a malformed exercise item (missing id)", () => {
    const broken = { ...validBackup, exercises: [{ name: "No Id", type: "main" }] };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("rejects a backup with a malformed exercise item (invalid type)", () => {
    const broken = { ...validBackup, exercises: [{ id: "e1", name: "Bad Type", type: "cardio" }] };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("rejects a backup with a malformed set item (weight not a number)", () => {
    const broken = {
      ...validBackup,
      sets: [
        {
          id: "set1",
          sessionId: "sess1",
          exerciseId: "e1",
          weight: "225",
          reps: 5,
          loggedAt: 1500,
        },
      ],
    };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("rejects a backup with an invalid unit", () => {
    const broken = { ...validBackup, unit: "stone" };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("rejects a backup with a non-boolean motivationEnabled", () => {
    const broken = { ...validBackup, motivationEnabled: "yes" };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("does not touch IndexedDB or the store when validation fails", async () => {
    await useStore.getState().hydrate();
    const before = useStore.getState();
    const dbCountBefore = await db.exercises.count();

    const result = parseBackup("{ this is not json");
    expect(result.ok).toBe(false);

    expect(useStore.getState()).toBe(before); // no state change at all
    expect(await db.exercises.count()).toBe(dbCountBefore);
  });
});

describe("importData (full backup restore)", () => {
  it("round-trips: export shape -> wipe -> import restores an equivalent state", async () => {
    // Seed a populated DB, then read it back out in exactly the shape
    // exportJson() in settings.tsx produces.
    await useStore.getState().hydrate();
    const seeded = useStore.getState();
    const exported: BackupData = {
      exercises: seeded.exercises,
      slots: seeded.slots,
      sessions: seeded.sessions,
      sets: seeded.sets,
      unit: seeded.unit,
      motivationEnabled: seeded.motivationEnabled,
    };
    // Round-trip through JSON, exactly as a real export/import cycle would.
    const roundTripped = parseBackup(JSON.stringify(exported));
    expect(roundTripped.ok).toBe(true);
    if (!roundTripped.ok) return;

    // Wipe, simulating starting from a different / empty device.
    await resetDb();
    useStore.setState({ ...DEFAULT_STATE });

    await useStore.getState().importData(roundTripped.data);
    const restored = useStore.getState();

    expect(restored.exercises).toEqual(exported.exercises);
    expect(restored.slots).toEqual(exported.slots);
    expect(restored.sessions).toEqual(exported.sessions);
    expect(restored.sets).toEqual(exported.sets);
    expect(restored.unit).toBe(exported.unit);
    expect(restored.motivationEnabled).toBe(exported.motivationEnabled);

    // Also survives a simulated reload — i.e. it actually landed in Dexie,
    // not just in memory.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(sortById(reloaded.exercises)).toEqual(sortById(exported.exercises));
    expect(sortById(reloaded.slots)).toEqual(sortById(exported.slots));
    expect(sortById(reloaded.sessions)).toEqual(sortById(exported.sessions));
    expect(sortById(reloaded.sets)).toEqual(sortById(exported.sets));
    expect(reloaded.unit).toBe(exported.unit);
    expect(reloaded.motivationEnabled).toBe(exported.motivationEnabled);
  });

  it("replaces existing data rather than merging with it", async () => {
    await useStore.getState().hydrate();
    const preexistingCount = useStore.getState().exercises.length;
    expect(preexistingCount).toBeGreaterThan(0);

    await useStore.getState().importData(validBackup);
    const state = useStore.getState();

    // Only the imported exercise remains — the seeded ones are gone.
    expect(state.exercises).toEqual(validBackup.exercises);
    expect(await db.exercises.count()).toBe(validBackup.exercises.length);
  });

  it("clears any in-progress workout, since a fresh backup has none", async () => {
    await useStore.getState().hydrate();
    const exercise = useStore.getState().exercises[0];
    useStore.getState().startWorkout("Some Slot");
    useStore.getState().setCurrentExercise(exercise.id);
    expect(useStore.getState().activeSessionId).toBeDefined();

    await useStore.getState().importData(validBackup);
    const state = useStore.getState();

    expect(state.activeSessionId).toBeUndefined();
    expect(state.currentExerciseId).toBeUndefined();
    expect(state.currentBlock).toBeUndefined();

    const activeSessionMeta = await db.meta.get("activeSession");
    expect(activeSessionMeta).toEqual({ key: "activeSession" });
  });

  it("persists the imported unit and motivationEnabled to the settings meta record", async () => {
    await useStore.getState().hydrate();
    await useStore.getState().importData(validBackup);

    const settingsMeta = await db.meta.get("settings");
    expect(settingsMeta).toMatchObject({ unit: "kg", motivationEnabled: false });
  });
});
