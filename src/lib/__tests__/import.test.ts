import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { BACKUP_VERSION, isCardioSession, parseBackup, useStore, type BackupData } from "../store";

// fake-indexeddb/auto (loaded globally in src/test/setup.ts) gives us a real
// IndexedDB implementation backed by memory, so the round-trip test below
// exercises Dexie's actual read/write paths, not a mock.

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

/** Order-insensitive comparison: Dexie's toArray() returns rows in primary-key
 * order, which need not match the order entities were originally created or
 * imported in. Content equality is what matters for a restore, not order. */
function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

/** Same idea as sortById, for daily logs (keyed by `date`, not `id`). */
function sortByDate<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date));
}

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

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE });
});

const validBackup: BackupData = {
  version: 2,
  exercises: [{ id: "e1", name: "Bench Press", type: "main" }],
  slots: [{ id: "s1", name: "Heavy Bench", rotationOrder: 0 }],
  sessions: [{ id: "sess1", splitSlotId: "s1", startedAt: 1000, endedAt: 2000 }],
  sets: [
    { id: "set1", sessionId: "sess1", exerciseId: "e1", weight: 225, reps: 5, loggedAt: 1500 },
  ],
  dailyLogs: [{ date: "2026-03-01", calories: 2400, steps: 0, isCheatDay: true }],
  unit: "kg",
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
    // NB: "cardio" used to be the example of an invalid type here. It is a real
    // ExerciseType as of backup v3, so this needs a genuinely unknown value.
    const broken = {
      ...validBackup,
      exercises: [{ id: "e1", name: "Bad Type", type: "mobility" }],
    };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("accepts an exercise of type cardio", () => {
    const ok = { ...validBackup, exercises: [{ id: "e1", name: "Treadmill", type: "cardio" }] };
    const result = parseBackup(JSON.stringify(ok));
    expect(result.ok).toBe(true);
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

  it("rejects a backup whose dailyLogs entry is missing a date", () => {
    const broken = { ...validBackup, dailyLogs: [{ calories: 2000 }] };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("The backup's daily logs list is malformed.");
  });

  it("rejects a backup whose dailyLogs entry has a non-numeric field", () => {
    const broken = { ...validBackup, dailyLogs: [{ date: "2026-03-01", calories: "2000" }] };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("The backup's daily logs list is malformed.");
  });

  it("rejects a backup whose dailyLogs is present but not an array", () => {
    const broken = { ...validBackup, dailyLogs: "nope" };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("The backup's daily logs list is malformed.");
  });

  it("accepts a dailyLogs entry that has only a date, and one with an explicit zero", () => {
    const ok = {
      ...validBackup,
      dailyLogs: [{ date: "2026-03-01" }, { date: "2026-03-02", steps: 0, isCheatDay: false }],
    };
    const result = parseBackup(JSON.stringify(ok));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.dailyLogs).toHaveLength(2);
  });

  it("accepts an unrecognised future version on a best-effort basis", () => {
    const future = { ...validBackup, version: 99 };
    const result = parseBackup(JSON.stringify(future));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe(99);
      expect(result.data.dailyLogs).toEqual(validBackup.dailyLogs);
    }
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
    // Give the seeded state a couple of daily logs so the round-trip covers them.
    useStore.getState().upsertDailyLog("2026-02-10", { calories: 2100, protein: 180 });
    useStore.getState().upsertDailyLog("2026-02-11", { steps: 0, isCheatDay: true });
    const exported: BackupData = {
      version: 2,
      exercises: seeded.exercises,
      slots: seeded.slots,
      sessions: seeded.sessions,
      sets: seeded.sets,
      dailyLogs: useStore.getState().dailyLogs,
      unit: seeded.unit,
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
    expect(restored.dailyLogs).toEqual(exported.dailyLogs);
    expect(restored.unit).toBe(exported.unit);

    // Also survives a simulated reload — i.e. it actually landed in Dexie,
    // not just in memory.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(sortById(reloaded.exercises)).toEqual(sortById(exported.exercises));
    expect(sortById(reloaded.slots)).toEqual(sortById(exported.slots));
    expect(sortById(reloaded.sessions)).toEqual(sortById(exported.sessions));
    expect(sortById(reloaded.sets)).toEqual(sortById(exported.sets));
    expect(sortByDate(reloaded.dailyLogs)).toEqual(sortByDate(exported.dailyLogs));
    expect(reloaded.unit).toBe(exported.unit);
  });

  it("parses and imports an old-format backup that still contains a motivationEnabled key", async () => {
    // Old exports included a motivationEnabled field that no longer exists in
    // BackupData. parseBackup's type guards only check known properties and
    // ignore extras, so a file like this must still parse and import cleanly.
    const oldFormatBackup = { ...validBackup, motivationEnabled: true };
    const result = parseBackup(JSON.stringify(oldFormatBackup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);
    const state = useStore.getState();

    expect(state.exercises).toEqual(validBackup.exercises);
    expect(state.unit).toBe(validBackup.unit);
  });

  it("parses and imports a v1 backup with no version and no dailyLogs key", async () => {
    // The shape every export written before daily logging produced.
    const v1Backup: Record<string, unknown> = { ...validBackup };
    delete v1Backup.version;
    delete v1Backup.dailyLogs;
    expect("dailyLogs" in v1Backup).toBe(false);

    const result = parseBackup(JSON.stringify(v1Backup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(1);
    expect(result.data.dailyLogs).toEqual([]);

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);

    expect(useStore.getState().dailyLogs).toEqual([]);
    expect(useStore.getState().exercises).toEqual(validBackup.exercises);
    expect(await db.dailyLogs.count()).toBe(0);
  });

  it("restores daily logs into IndexedDB, not just into memory", async () => {
    await useStore.getState().hydrate();
    await useStore.getState().importData(validBackup);

    expect(useStore.getState().dailyLogs).toEqual(validBackup.dailyLogs);
    expect(await db.dailyLogs.get("2026-03-01")).toMatchObject({
      date: "2026-03-01",
      calories: 2400,
      steps: 0,
      isCheatDay: true,
    });
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

  it("imports a v2 backup that has no kind on any session", async () => {
    // validBackup is exactly that shape: version 2, sessions with a splitSlotId
    // and no kind. Those sessions must come back reading as strength.
    expect(validBackup.sessions.every((s) => !("kind" in s))).toBe(true);
    const result = parseBackup(JSON.stringify(validBackup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);

    const restored = useStore.getState().sessions;
    expect(restored).toEqual(validBackup.sessions);
    expect(restored.every((s) => !isCardioSession(s))).toBe(true);
  });

  it("round-trips a v3 backup carrying cardio sessions and a cardio exercise", async () => {
    const v3Backup: BackupData = {
      version: BACKUP_VERSION,
      exercises: [
        { id: "e1", name: "Bench Press", type: "main" },
        { id: "e2", name: "Treadmill", type: "cardio" },
      ],
      slots: [{ id: "s1", name: "Heavy Bench", rotationOrder: 0 }],
      sessions: [
        { id: "sess1", splitSlotId: "s1", startedAt: 1000, endedAt: 2000 },
        {
          id: "run1",
          startedAt: 3000,
          endedAt: 4680,
          kind: "cardio",
          cardioExerciseId: "e2",
          durationMinutes: 28,
          distance: 3.1,
          setupNote: "incline 2",
        },
      ],
      sets: [
        { id: "set1", sessionId: "sess1", exerciseId: "e1", weight: 225, reps: 5, loggedAt: 1500 },
      ],
      dailyLogs: [],
      unit: "lbs",
    };
    expect(v3Backup.version).toBe(3);

    const result = parseBackup(JSON.stringify(v3Backup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(v3Backup);

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);
    expect(useStore.getState().sessions).toEqual(v3Backup.sessions);

    // And it actually landed in Dexie, not just in memory.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(sortById(reloaded.sessions)).toEqual(sortById(v3Backup.sessions));
    expect(sortById(reloaded.exercises)).toEqual(sortById(v3Backup.exercises));
    expect(reloaded.sessions.filter(isCardioSession)).toHaveLength(1);
  });

  it("rejects a session whose kind is neither strength nor cardio", () => {
    const broken = {
      ...validBackup,
      sessions: [{ id: "sess1", splitSlotId: "s1", startedAt: 1000, kind: "swimming" }],
    };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("rejects a session whose splitSlotId is present but not a string", () => {
    const broken = { ...validBackup, sessions: [{ id: "sess1", splitSlotId: 7, startedAt: 1000 }] };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });

  it("accepts a session with no splitSlotId at all", () => {
    const ok = {
      ...validBackup,
      sessions: [{ id: "run1", startedAt: 1000, endedAt: 2000, kind: "cardio" }],
    };
    const result = parseBackup(JSON.stringify(ok));
    expect(result.ok).toBe(true);
  });

  it("persists the imported unit to the settings meta record", async () => {
    await useStore.getState().hydrate();
    await useStore.getState().importData(validBackup);

    const settingsMeta = await db.meta.get("settings");
    expect(settingsMeta).toMatchObject({ unit: "kg" });
  });
});
