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
  // Cleared to empty/false rather than to the app's defaults, deliberately. This
  // object stands in for a fresh process that has not read IndexedDB yet, and
  // pre-filling it with the same values a correct hydrate would produce is
  // exactly how a "survives a reload" assertion passes without the reload having
  // read anything at all.
  activeSessionId: undefined,
  currentExerciseId: undefined,
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
  nutritionPhases: [],
  plannedDays: [],
  templates: [],
  nextSlotId: undefined,
  // The plan rides along on v4 without a version bump, so "an old file" means
  // one with no plan keys at all. `undefined` is what parseBackup hands back
  // for exactly that file, which is why it belongs in the shared defaults
  // rather than being an empty week: a week of seven rest days is a plan the
  // author of these files never made.
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
  dailyLogs: [{ date: "2026-03-01", calories: 2400, steps: 0 }],
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

  /**
   * The numbers on a set, checked as values rather than as types.
   *
   * `typeof weight === "number"` used to be the whole test, which let Infinity,
   * negative loads, fractional and zero rep counts through into arithmetic that
   * cannot defend itself: volume sums them, charts scale axes by them, and
   * pr.ts compares them to decide what to celebrate.
   *
   * These fixtures are composed as RAW JSON TEXT on purpose. JSON.stringify
   * turns Infinity into `null`, so a fixture built from an object literal would
   * be testing that null is rejected and quietly proving nothing about the case
   * it is named for. Writing the text by hand is what puts a genuine `1e999` in
   * front of JSON.parse, which is exactly how an overflowing number reaches a
   * real import: JSON has no Infinity literal, but it does have exponents.
   *
   * A literal NaN has no JSON representation at all and makes the file a syntax
   * error, so `parseBackup` turns it away one step earlier, at JSON.parse. The
   * finite checks in `isWorkoutSet` still earn their place: -1e999 is reachable,
   * and the guard is what stops a future caller reusing it on in-memory data
   * from inheriting the old hole.
   */
  describe("set values that parse as numbers but are not sets that happened", () => {
    /** Splices a raw sets array into an otherwise valid backup, unstringified. */
    function backupWithRawSets(rawSets: string): string {
      const { sets: _omitted, ...rest } = validBackup;
      const body = JSON.stringify(rest);
      return `${body.slice(0, -1)},"sets":${rawSets}}`;
    }

    /** One set, valid apart from whatever `fields` overrides. */
    function rawSet(fields: string): string {
      return `[{"id":"set1","sessionId":"sess1","exerciseId":"e1","loggedAt":1500,${fields}}]`;
    }

    function expectRejected(rawSets: string) {
      const result = parseBackup(backupWithRawSets(rawSets));
      expect(result.ok).toBe(false);
      // Asserted so a test cannot pass by failing somewhere else entirely, e.g.
      // on malformed JSON rather than on the value under test.
      if (!result.ok) expect(result.error).toBe("The backup's sets list is missing or malformed.");
    }

    function expectAccepted(rawSets: string) {
      const result = parseBackup(backupWithRawSets(rawSets));
      expect(result.ok).toBe(true);
    }

    it("rejects a weight that overflows to Infinity", () => {
      expectRejected(rawSet(`"weight":1e999,"reps":5`));
    });

    it("rejects a weight that overflows to -Infinity", () => {
      expectRejected(rawSet(`"weight":-1e999,"reps":5`));
    });

    it("rejects a negative weight", () => {
      expectRejected(rawSet(`"weight":-45,"reps":5`));
    });

    it("rejects a null weight, which is what a stringified NaN becomes", () => {
      expectRejected(rawSet(`"weight":null,"reps":5`));
    });

    it("accepts a weight of 0, because a pull-up is a real set", () => {
      // The one place this validator deliberately stays loose. An unloaded set
      // is not a corrupt set, and rejecting it would refuse honest files.
      expectAccepted(rawSet(`"weight":0,"reps":8`));
    });

    it("rejects a set of zero reps", () => {
      expectRejected(rawSet(`"weight":225,"reps":0`));
    });

    it("rejects a negative rep count", () => {
      expectRejected(rawSet(`"weight":225,"reps":-5`));
    });

    it("rejects a fractional rep count", () => {
      expectRejected(rawSet(`"weight":225,"reps":5.5`));
    });

    it("rejects a rep count that overflows to Infinity", () => {
      expectRejected(rawSet(`"weight":225,"reps":1e999`));
    });

    it("rejects a non-finite rpe", () => {
      expectRejected(rawSet(`"weight":225,"reps":5,"rpe":1e999`));
    });

    it("rejects a non-finite rest time", () => {
      expectRejected(rawSet(`"weight":225,"reps":5,"timeBetweenSetsSeconds":1e999`));
    });

    it("accepts a NEGATIVE rest time, which the app itself can write", () => {
      // Not an oversight. logSet derives this from two clock readings, so a
      // device whose clock corrects backwards mid session produces a negative
      // value with no help from a corrupt file. Rejecting it would refuse a
      // backup the app made, over a number that is only ever displayed.
      expectAccepted(rawSet(`"weight":225,"reps":5,"timeBetweenSetsSeconds":-30`));
    });

    it("rejects a non-finite loggedAt, which would scramble session ordering", () => {
      const raw = `[{"id":"set1","sessionId":"sess1","exerciseId":"e1","weight":225,"reps":5,"loggedAt":1e999}]`;
      expectRejected(raw);
    });

    it("rejects an empty sessionId or exerciseId, which point at nothing", () => {
      expectRejected(
        `[{"id":"set1","sessionId":"","exerciseId":"e1","weight":225,"reps":5,"loggedAt":1500}]`,
      );
      expectRejected(
        `[{"id":"set1","sessionId":"sess1","exerciseId":"","weight":225,"reps":5,"loggedAt":1500}]`,
      );
    });

    it("still accepts an ordinary set, with and without its optional fields", () => {
      expectAccepted(rawSet(`"weight":102.5,"reps":5`));
      expectAccepted(
        rawSet(
          `"weight":102.5,"reps":5,"rpe":8.5,"isDropsetOrPartial":true,"setupNote":"seat 4","timeBetweenSetsSeconds":0,"blockGroupId":"b1"`,
        ),
      );
    });
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
      dailyLogs: [{ date: "2026-03-01" }, { date: "2026-03-02", steps: 0, isUntracked: false }],
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
    useStore.getState().logSet({ exerciseId: benchId, weight: 225, reps: 3 });
    useStore.getState().logSet({ exerciseId: benchId, weight: 225, reps: 2 });
    useStore.getState().endWorkout();
    const seeded = useStore.getState();
    expect(seeded.slots).toHaveLength(1);
    expect(seeded.sessions).toHaveLength(1);
    expect(seeded.sets).toHaveLength(2);
    // Give the seeded state a couple of daily logs so the round-trip covers them.
    useStore.getState().upsertDailyLog("2026-02-10", { calories: 2100, protein: 180 });
    useStore.getState().upsertDailyLog("2026-02-11", { steps: 0 });
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

  it("round-trips a v4 backup, dropping the food and habit keys it still carries", async () => {
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
      dailyLogs: [{ date: "2026-03-01", calories: 2400, steps: 0 }],
      // A v4 file predates the planning timeline entirely.
      nutritionPhases: [],
      plannedDays: [],
      templates: [],
      nextSlotId: undefined,
      // Not the default, so a settings record that failed to persist is visible.
      unit: "kg",
    };

    // What a real v4 file on disk looks like: everything above, plus the food
    // and habit tables this version of the app no longer has a home for. The
    // user's own pre-overhaul export carries exactly these, so "tolerated and
    // dropped" is the behaviour a restore depends on -- parseBackup rejecting
    // the file, or carrying the keys through into state, are both data loss.
    const v4FileOnDisk = {
      ...v4Backup,
      habits: [
        { id: "h1", name: "Creatine", order: 0 },
        { id: "h2", name: "Evening stretch", order: 1, archived: true },
      ],
      habitEntries: [
        { id: "2026-03-01|h1", date: "2026-03-01", habitId: "h1" },
        { id: "2026-03-02|h1", date: "2026-03-02", habitId: "h1" },
      ],
      habitsEnabled: true,
      foodEnabled: true,
      foods: [{ id: "f1", name: "Kimchi", basisQuantity: 100, basisUnit: "g" }],
      foodEntries: [{ id: "fe1", date: "2026-03-01", mealId: "m1", name: "Kimchi" }],
      meals: [{ id: "m1", name: "Breakfast", fromMinutes: 300, toMinutes: 660 }],
      recipes: [{ id: "r1", name: "Overnight oats", servings: 2 }],
      recipeIngredients: [{ id: "ri1", recipeId: "r1", foodId: "f1" }],
      // The weekly-template planning model, which v6 replaced with a dated
      // timeline. Dropped rather than converted: the Dexie upgrade migrates a
      // LIVE database, where one profile unambiguously meant "these are my
      // targets", but inventing a phase timeline out of a weekday table would
      // fabricate start dates the file never contained.
      targetProfiles: [
        { id: "tp_train", name: "Training", calories: 2800, protein: 200, steps: 10000 },
        { id: "tp_rest", name: "Rest", calories: 2200, protein: 190 },
      ],
      weekdayTargets: [
        "tp_train",
        "tp_rest",
        "tp_train",
        "tp_rest",
        "tp_train",
        "tp_rest",
        "tp_rest",
      ],
      plannedWeek: [
        { name: "Heavy Bench", exerciseIds: ["e1"] },
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    };

    const result = parseBackup(JSON.stringify(v4FileOnDisk));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Everything the app still has a home for survives verbatim, and nothing
    // else rides along. `toEqual` on the whole object is the point twice over: a
    // field added to BackupData later and forgotten in parseBackup fails here,
    // and so does a dropped table quietly reappearing in state.
    expect(result.data).toEqual(v4Backup);

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);
    const restored = useStore.getState();
    expect(restored.nutritionPhases).toEqual([]);
    expect(restored.plannedDays).toEqual([]);
    expect(restored.sessions).toEqual(v4Backup.sessions);

    // The half that actually matters for a restore: read it back out of
    // IndexedDB, not out of the store we just set.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(reloaded.nutritionPhases).toEqual([]);
    expect(reloaded.unit).toBe("kg");
    expect(sortById(reloaded.sessions)).toEqual(sortById(v4Backup.sessions));
    expect(sortByDate(reloaded.dailyLogs)).toEqual(sortByDate(v4Backup.dailyLogs));
  });

  it("round-trips a v5 backup carrying a phase timeline and a pinned day", async () => {
    // The CURRENT format. The v4 test above stopped covering it the moment the
    // planning timeline landed, which is exactly what the tripwire below is for.
    const v5Backup: BackupData = {
      version: 5,
      exercises: [{ id: "e1", name: "Bench Press", type: "main" }],
      slots: [
        // The lifts live on the slot now, so a backup that lost this field would
        // lose the whole training plan while looking complete.
        { id: "s1", name: "Upper", rotationOrder: 0, plannedLifts: [{ exerciseId: "e1" }] },
      ],
      sessions: [],
      sets: [],
      dailyLogs: [],
      // The user's own stated case, which is what the model exists to express.
      nutritionPhases: [
        {
          id: "np_maint",
          startsOn: "2026-09-13",
          name: "Maintenance",

          calories: 3400,
          steps: 20000,
        },
        { id: "np_off", startsOn: "2026-09-19", name: "Off" },
        {
          id: "np_cut",
          startsOn: "2026-09-20",
          name: "Cut",

          calories: 3000,
          steps: 24000,
        },
      ],
      plannedDays: [{ date: "2026-09-21", splitSlotId: "s1" }],
      templates: [],
      nextSlotId: undefined,
      unit: "lbs",
    };

    const result = parseBackup(JSON.stringify(v5Backup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // NOT verbatim, and deliberately so. This file predates end dates, where a
    // phase ran until the next one started; read literally under the current
    // rules every row would be open-ended and therefore overlapping every row
    // after it. The reader derives the ends the old shape implied, which is the
    // same migration the stored timeline gets on hydration.
    expect(result.data.nutritionPhases.map((p) => [p.startsOn, p.endsOn])).toEqual([
      ["2026-09-13", "2026-09-18"],
      ["2026-09-19", "2026-09-19"],
      ["2026-09-20", undefined],
    ]);
    expect({ ...result.data, nutritionPhases: [] }).toEqual({ ...v5Backup, nutritionPhases: [] });
    const expectedPhases = result.data.nutritionPhases;

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);

    // Read back out of IndexedDB rather than out of the store we just set: the
    // phases and pins are their own tables now, so an import that only reached
    // memory would look perfect until the next launch.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(sortById(reloaded.nutritionPhases)).toEqual(sortById(expectedPhases));
    expect(reloaded.plannedDays).toEqual(v5Backup.plannedDays);
    expect(reloaded.slots[0].plannedLifts?.map((l) => l.exerciseId)).toEqual(["e1"]);
  });

  it("drops a pin naming a slot the file does not contain", () => {
    // A pin is only meaningful against a split that exists. One left over from a
    // deleted slot would preload a workout from a rotation that is gone.
    const file = {
      version: 5,
      exercises: [],
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      nutritionPhases: [],
      plannedDays: [{ date: "2026-09-21", splitSlotId: "s_deleted" }],
      templates: [],
      nextSlotId: undefined,
      unit: "lbs",
    };
    const result = parseBackup(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.plannedDays).toEqual([]);
  });

  it("round-trips a v6 backup carrying workout templates", async () => {
    // Templates are written once and reused for years, so a restore that
    // dropped them would cost more than it looks: the file is the only copy.
    const v6Backup = {
      version: 6,
      exercises: [{ id: "e1", name: "Bench Press", type: "main" as const }],
      slots: [{ id: "s1", name: "Upper", rotationOrder: 0, weekday: 1 }],
      sessions: [],
      sets: [],
      dailyLogs: [],
      nutritionPhases: [],
      plannedDays: [],
      templates: [
        {
          id: "tpl_upper",
          name: "Upper A",
          // Lifts are NAMES: a template is applied to whoever is on screen, and
          // in coach mode that is a client whose exercise ids are their own.
          lifts: [
            { name: "Bench Press", sets: 3, reps: "8-12", load: "RPE 8" },
            { name: "Face Pull" },
          ],
        },
      ],
      nextSlotId: undefined,
      unit: "lbs" as const,
    };

    const result = parseBackup(JSON.stringify(v6Backup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(v6Backup);

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);

    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    expect(useStore.getState().templates).toEqual(v6Backup.templates);
    // The weekday rides along on the slot record, so a week survives a restore.
    expect(useStore.getState().slots[0].weekday).toBe(1);
  });

  it("reads a file older than templates as having none, rather than refusing it", () => {
    const older: Record<string, unknown> = { ...validBackup, version: 5 };
    delete older.templates;
    const result = parseBackup(JSON.stringify(older));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.templates).toEqual([]);
  });

  it("still has 6 as the current backup format", () => {
    // A tripwire, not a fact worth asserting for its own sake. The round-trip
    // above is pinned to version 6, so it stops covering the CURRENT format the
    // moment the format moves on - and the newest format is the one whose export
    // users are actually holding. When this fails, write the v7 fixture; do not
    // just bump the number.
    expect(BACKUP_VERSION).toBe(6);
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
      "nutritionPhases",
      "plannedDays",
    ]) {
      delete legacyBackup[key];
    }

    const result = parseBackup(JSON.stringify(legacyBackup));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(2);
    // An empty timeline, and nothing invented. A file written before planning
    // existed has no phases, and defaulting one in would claim the user had been
    // aiming at numbers they never set.
    expect(result.data.nutritionPhases).toEqual([]);
    expect(result.data.plannedDays).toEqual([]);

    await useStore.getState().hydrate();
    await useStore.getState().importData(result.data);

    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();
    const reloaded = useStore.getState();
    expect(reloaded.nutritionPhases).toEqual([]);
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

describe("parseBackup: the isCheatDay rename", () => {
  /**
   * A pre-rename export is the only copy of that data the user has. There is no
   * backend and no sync to re-derive it from, so a flag dropped on import is a
   * decision they made about a day that is now unrecoverable.
   */
  const withLogs = (dailyLogs: unknown[]) =>
    JSON.stringify({
      version: 2,
      exercises: [{ id: "e1", name: "Bench Press", type: "main" }],
      slots: [{ id: "s1", name: "Heavy Bench", rotationOrder: 0 }],
      sessions: [],
      sets: [],
      dailyLogs,
      unit: "lbs",
    });

  it("drops both spellings of the dead untracked flag", () => {
    // The field was renamed once (isCheatDay -> isUntracked) and then removed
    // outright, so a backup can carry either. Neither has anywhere to land, and
    // a day carrying only one of them is a day with nothing logged.
    for (const legacy of [{ isCheatDay: true }, { isUntracked: true }]) {
      const result = parseBackup(withLogs([{ date: "2026-03-01", ...legacy }]));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.dailyLogs).toEqual([{ date: "2026-03-01" }]);
    }
  });

  it("keeps the numbers on a row that also carried the flag", () => {
    // The flag goes; everything the day actually recorded stays. Dropping the
    // whole row would lose real data to a field nobody asked about.
    const result = parseBackup(
      withLogs([{ date: "2026-03-01", calories: 2400, isCheatDay: false }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dailyLogs).toEqual([{ date: "2026-03-01", calories: 2400 }]);
  });
});
