import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TARGET_PROFILE_ID, db, defaultTargets } from "../db";
import {
  BACKUP_VERSION,
  habitEntryId,
  isCardioSession,
  parseBackup,
  useStore,
  type BackupData,
} from "../store";

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
  habits: [],
  habitEntries: [],
  // Cleared to empty/false rather than to the app's defaults, deliberately. This
  // object stands in for a fresh process that has not read IndexedDB yet, and
  // pre-filling it with the same values a correct hydrate would produce is
  // exactly how a "survives a reload" assertion passes without the reload having
  // read anything at all.
  targetProfiles: [],
  weekdayTargets: [],
  targetsEnabled: false,
  habitsEnabled: false,
  toolsEnabled: false,
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

// Clears every table the current schema has. habits and habitEntries are not
// optional extras here: the v4 fixtures below write real rows into them, and a
// reset that skipped them would leak those rows into the tests that assert an
// older backup lands with no habits at all.
async function resetDb() {
  await Promise.all([
    db.exercises.clear(),
    db.slots.clear(),
    db.sessions.clear(),
    db.sets.clear(),
    db.dailyLogs.clear(),
    db.habits.clear(),
    db.habitEntries.clear(),
    db.meta.clear(),
  ]);
}

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE });
});

/**
 * What a pre-v4 backup necessarily carries once parsed: no habits, and the
 * single uniform target profile `parseBackup` substitutes in. Spread into the
 * fixtures below so each one keeps saying only what its own version is ABOUT,
 * rather than restating seven fields that are the same in all of them.
 *
 * Named for the versions it describes, not for the version that introduced the
 * fields. Every fixture spreading this one is an OLD file, and a name reading
 * V4_DEFAULTS invited the misreading that these are what a current backup looks
 * like - which is what let `version: BACKUP_VERSION` sit in a v3 fixture.
 */
const PRE_V4_DEFAULTS = {
  habits: [],
  habitEntries: [],
  ...defaultTargets(),
  targetsEnabled: false,
  habitsEnabled: false,
  toolsEnabled: false,
};

const validBackup: BackupData = {
  ...PRE_V4_DEFAULTS,
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
    // Logged here rather than relied on from the seed: a first run has no
    // history at all any more, so a round-trip that only exported what hydrate
    // wrote would be asserting that three empty arrays survive a JSON trip.
    const benchId = useStore.getState().exercises[0].id;
    useStore.getState().startWorkout("Heavy Bench");
    useStore.getState().logSet({ exerciseId: benchId, weight: 225, reps: 3, targetSets: 2 });
    useStore.getState().logNextInBlock({ reps: 2 });
    useStore.getState().endWorkout();
    const seeded = useStore.getState();
    expect(seeded.slots).toHaveLength(1);
    expect(seeded.sessions).toHaveLength(1);
    expect(seeded.sets).toHaveLength(2);
    // Give the seeded state a couple of daily logs so the round-trip covers them.
    useStore.getState().upsertDailyLog("2026-02-10", { calories: 2100, protein: 180 });
    useStore.getState().upsertDailyLog("2026-02-11", { steps: 0, isCheatDay: true });
    const exported: BackupData = {
      ...PRE_V4_DEFAULTS,
      // A v2-era export. The current format's own round-trip lives in the
      // "restores every v4 field" test further down.
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
      ...PRE_V4_DEFAULTS,
      // Hardcoded, never BACKUP_VERSION. This fixture's whole job is to be an
      // OLD file, and writing it as BACKUP_VERSION only looked right for as long
      // as the constant happened to equal 3: the moment v4 landed, this stopped
      // being a v3 test and started claiming to be a v4 file that carried none
      // of v4's data.
      version: 3,
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

    const result = parseBackup(JSON.stringify(v3Backup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The parser reports the version it read, rather than normalising an old file
    // up to the current one. Asserting `v3Backup.version` here instead would just
    // be re-reading the literal three lines above.
    expect(result.data.version).toBe(3);
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

  it("round-trips a v4 backup with every habit, target and toggle field intact", async () => {
    // The reason this test earns its length: an exported file is the ONLY copy of
    // this data. There is no backend and no sync, so a v4 field that quietly
    // failed to survive export -> parse -> import is not a bug the user can work
    // around, it is data they can never get back.
    const v4Backup: BackupData = {
      // Hardcoded for the same reason as the v3 fixture: this fixture IS a v4
      // file, not "whatever the current version happens to be". When the format
      // moves to 5, the guard test below fails and the answer is a new v5 fixture
      // beside this one, not a bump here that would leave v4 uncovered.
      version: 4,
      exercises: [{ id: "e1", name: "Bench Press", type: "main" }],
      slots: [{ id: "s1", name: "Heavy Bench", rotationOrder: 0 }],
      sessions: [
        // `note` is the other thing v4 added. It is non-indexed and parseBackup
        // does not validate it, which is precisely why it needs asserting: it
        // rides along on the object or it is lost, and nothing else would notice.
        { id: "sess1", splitSlotId: "s1", startedAt: 1000, endedAt: 2000, note: "felt flat" },
      ],
      sets: [
        { id: "set1", sessionId: "sess1", exerciseId: "e1", weight: 225, reps: 5, loggedAt: 1500 },
      ],
      dailyLogs: [{ date: "2026-03-01", calories: 2400, steps: 0, isCheatDay: true }],
      habits: [
        { id: "h1", name: "Creatine", order: 0 },
        // One archived habit, because archiving is what keeps old entries
        // meaningful - dropping the flag on import would resurrect a habit the
        // user retired.
        { id: "h2", name: "Evening stretch", order: 1, archived: true },
      ],
      habitEntries: [
        // Built through the same helper the app uses, so this fixture cannot
        // drift from the real composite-key format.
        { id: habitEntryId("2026-03-01", "h1"), date: "2026-03-01", habitId: "h1" },
        { id: habitEntryId("2026-03-02", "h1"), date: "2026-03-02", habitId: "h1" },
      ],
      // TWO profiles, spread unevenly across the week, deliberately. With a single
      // uniform profile this test would still pass if parseBackup discarded the
      // file's targets and fell back to defaults, because the defaults are exactly
      // that shape. An uneven assignment is something the fallback cannot produce,
      // so a fallback shows up here as a failure instead of a false pass.
      targetProfiles: [
        { id: "tp_train", name: "Training", calories: 2800, protein: 200, steps: 10000 },
        { id: "tp_rest", name: "Rest", calories: 2200, protein: 190 },
      ],
      // Monday first, matching the store's convention.
      weekdayTargets: [
        "tp_train",
        "tp_rest",
        "tp_train",
        "tp_rest",
        "tp_train",
        "tp_rest",
        "tp_rest",
      ],
      // All three true for the same anti-false-pass reason: parseBackup reads
      // these as `=== true`, so a fixture using `false` would be identical to the
      // field having been dropped on the floor.
      targetsEnabled: true,
      habitsEnabled: true,
      toolsEnabled: true,
      // Not the default, so a settings record that failed to persist is visible.
      unit: "kg",
    };

    const result = parseBackup(JSON.stringify(v4Backup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Verbatim after a real trip through JSON. `toEqual` on the whole object is
    // the point: a field added to BackupData later and forgotten in parseBackup
    // fails here without anyone having to remember to assert it.
    expect(result.data).toEqual(v4Backup);

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);
    const restored = useStore.getState();
    expect(restored.habits).toEqual(v4Backup.habits);
    expect(restored.habitEntries).toEqual(v4Backup.habitEntries);
    expect(restored.targetProfiles).toEqual(v4Backup.targetProfiles);
    expect(restored.weekdayTargets).toEqual(v4Backup.weekdayTargets);
    expect(restored.targetsEnabled).toBe(true);
    expect(restored.habitsEnabled).toBe(true);
    expect(restored.toolsEnabled).toBe(true);
    expect(restored.sessions).toEqual(v4Backup.sessions);

    // The half that actually matters for a restore: read it back out of
    // IndexedDB, not out of the store we just set.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(sortById(reloaded.habits)).toEqual(sortById(v4Backup.habits));
    expect(sortById(reloaded.habitEntries)).toEqual(sortById(v4Backup.habitEntries));
    expect(reloaded.targetProfiles).toEqual(v4Backup.targetProfiles);
    expect(reloaded.weekdayTargets).toEqual(v4Backup.weekdayTargets);
    expect(reloaded.targetsEnabled).toBe(true);
    expect(reloaded.habitsEnabled).toBe(true);
    expect(reloaded.toolsEnabled).toBe(true);
    expect(reloaded.unit).toBe("kg");
    expect(sortById(reloaded.sessions)).toEqual(sortById(v4Backup.sessions));
    expect(sortByDate(reloaded.dailyLogs)).toEqual(sortByDate(v4Backup.dailyLogs));
    // The habitEntries indexes are what Today and habit deletion query through,
    // so a restore that landed the rows without them would read as an empty day.
    expect(await db.habitEntries.where("date").equals("2026-03-01").count()).toBe(1);
    expect(await db.habitEntries.where("habitId").equals("h1").count()).toBe(2);
  });

  it("still has 4 as the current backup format", () => {
    // A tripwire, not a fact worth asserting for its own sake. The round-trip
    // above is pinned to version 4, so it stops covering the CURRENT format the
    // moment the format moves on - and the newest format is the one whose export
    // users are actually holding. When this fails, write the v5 fixture; do not
    // just bump the number.
    expect(BACKUP_VERSION).toBe(4);
  });

  it("imports a v2 file that has no habit, target or toggle keys and lands on the defaults", async () => {
    // Built by DELETING those keys rather than by setting them empty: the file on
    // disk genuinely does not have them, and absent takes a different branch
    // through parseBackup than present-but-empty does.
    const legacyBackup: Record<string, unknown> = { ...validBackup, version: 2 };
    for (const key of [
      "habits",
      "habitEntries",
      "targetProfiles",
      "weekdayTargets",
      "targetsEnabled",
      "habitsEnabled",
      "toolsEnabled",
    ]) {
      delete legacyBackup[key];
    }

    const result = parseBackup(JSON.stringify(legacyBackup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(2);
    expect(result.data.habits).toEqual([]);
    expect(result.data.habitEntries).toEqual([]);
    // Exactly one profile, and every weekday pointing at it. The count matters as
    // much as the contents: a weekdayTargets of any length but 7 is treated as
    // "no target at all" by targets.ts, so a sloppy fallback would silently leave
    // the feature dead rather than defaulted.
    expect(result.data.targetProfiles).toEqual(defaultTargets().targetProfiles);
    expect(result.data.targetProfiles).toHaveLength(1);
    expect(result.data.weekdayTargets).toHaveLength(7);
    expect(result.data.weekdayTargets.every((id) => id === DEFAULT_TARGET_PROFILE_ID)).toBe(true);
    // And the features stay off. An old file cannot consent to a surface that did
    // not exist when it was written.
    expect(result.data.targetsEnabled).toBe(false);
    expect(result.data.habitsEnabled).toBe(false);
    expect(result.data.toolsEnabled).toBe(false);

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);

    // Empty in the DB too, not just in the store: hydrate is seeded from these
    // tables on every subsequent launch.
    expect(await db.habits.count()).toBe(0);
    expect(await db.habitEntries.count()).toBe(0);

    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(reloaded.habits).toEqual([]);
    expect(reloaded.habitEntries).toEqual([]);
    expect(reloaded.targetProfiles).toEqual(defaultTargets().targetProfiles);
    expect(reloaded.weekdayTargets).toHaveLength(7);
    expect(reloaded.weekdayTargets.every((id) => id === DEFAULT_TARGET_PROFILE_ID)).toBe(true);
    expect(reloaded.targetsEnabled).toBe(false);
    expect(reloaded.habitsEnabled).toBe(false);
    expect(reloaded.toolsEnabled).toBe(false);
    // The workout data the old file DID carry still arrived.
    expect(sortById(reloaded.exercises)).toEqual(sortById(validBackup.exercises));
    expect(reloaded.unit).toBe(validBackup.unit);
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
