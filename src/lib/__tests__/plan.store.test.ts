import { beforeEach, describe, expect, it } from "vitest";
import { db, type SettingsMeta } from "../db";
import { useStore, type Exercise } from "../store";
import { emptyPlannedWeek, type PlannedWeek } from "../plan";

// fake-indexeddb/auto (loaded globally in src/test/setup.ts) gives us a real
// IndexedDB implementation backed by memory, so these exercise Dexie's actual
// read/write paths rather than a mock.

/**
 * A fresh process that has not read IndexedDB yet. Cleared to off/absent rather
 * than to anything a correct hydrate would produce, for the reason spelled out
 * in import.test.ts: pre-filling it with the right answer is exactly how a
 * "survives a reload" assertion passes without the reload having read anything.
 */
const DEFAULT_STATE = {
  unit: "lbs" as const,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
  targetProfiles: [],
  weekdayTargets: [],
  plannedWeek: undefined,
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,
  hydrated: false,
};

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

async function storedSettings(): Promise<SettingsMeta | undefined> {
  return (await db.meta.get("settings")) as SettingsMeta | undefined;
}

const SQUAT: Exercise = { id: "e_squat", name: "Squat", type: "main" };
const BENCH: Exercise = { id: "e_bench", name: "Bench Press", type: "main" };

// 2026-08-10 (Mon) to 2026-08-16 (Sun) is one full Monday-to-Sunday week, the
// same fixture week targets.test.ts and plan.test.ts use.
const MONDAY = "2026-08-10";
const WEDNESDAY = "2026-08-12";
const SUNDAY = "2026-08-16";

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE });
});

describe("setPlannedDay", () => {
  it("plans one weekday, leaves the other six as rest, and survives a reload", async () => {
    await useStore.getState().hydrate();

    useStore.getState().setPlannedDay(2, { name: "Squat day", exerciseIds: ["e_squat"] });

    const week = useStore.getState().plannedWeek;
    expect(week).toHaveLength(7);
    expect(week?.[2]).toEqual({ name: "Squat day", exerciseIds: ["e_squat"] });
    expect(week?.filter((d) => d !== null)).toHaveLength(1);

    await flush();
    await reload();
    expect(useStore.getState().plannedWeek?.[2]).toEqual({
      name: "Squat day",
      exerciseIds: ["e_squat"],
    });
  });

  it("clears a day back to rest with null", async () => {
    await useStore.getState().hydrate();
    useStore.getState().setPlannedDay(6, { name: "Sunday", exerciseIds: ["e_squat"] });

    useStore.getState().setPlannedDay(6, null);

    expect(useStore.getState().plannedWeek?.[6]).toBeNull();
    await flush();
    await reload();
    expect(useStore.getState().plannedWeek?.[6]).toBeNull();
  });

  it("ignores an out-of-range weekday instead of growing the week", async () => {
    // Same guard as assignWeekdayTarget: a sparse 8-entry array would make every
    // later read of this week resolve to "no plan" (wrong length), silently
    // wiping a plan the user could still see on screen.
    await useStore.getState().hydrate();
    useStore.getState().setPlannedDay(0, { name: "Monday", exerciseIds: ["e_squat"] });

    useStore.getState().setPlannedDay(7, { name: "Nope", exerciseIds: ["e_squat"] });
    useStore.getState().setPlannedDay(-1, { name: "Nope", exerciseIds: ["e_squat"] });

    expect(useStore.getState().plannedWeek).toHaveLength(7);
    expect(useStore.getState().plannedWeek?.[0]).toEqual({
      name: "Monday",
      exerciseIds: ["e_squat"],
    });
  });

  it("repairs a wrong-length week rather than writing it back one day longer", async () => {
    // A hand-edited backup is the source of a 5-entry week. Every read of it
    // resolves to "no plan", so the first edit rebuilding it is the only way out
    // that does not need the user to know what happened.
    await useStore.getState().hydrate();
    useStore.setState({ plannedWeek: [null, null, null] as PlannedWeek });

    useStore.getState().setPlannedDay(1, { name: "Tuesday", exerciseIds: ["e_bench"] });

    const week = useStore.getState().plannedWeek;
    expect(week).toHaveLength(7);
    expect(week?.[1]).toEqual({ name: "Tuesday", exerciseIds: ["e_bench"] });
  });

  it("does not mutate the previous week in place", async () => {
    // Zustand hands the same array reference to every subscriber, so an in-place
    // write would leave React with an unchanged reference and no re-render.
    await useStore.getState().hydrate();
    useStore.getState().setPlannedDay(0, { name: "Monday", exerciseIds: ["e_squat"] });
    const before = useStore.getState().plannedWeek;

    useStore.getState().setPlannedDay(1, { name: "Tuesday", exerciseIds: ["e_bench"] });

    expect(useStore.getState().plannedWeek).not.toBe(before);
    expect(before?.[1]).toBeNull();
  });
});

describe("plannedWorkoutForDate", () => {
  beforeEach(async () => {
    await useStore.getState().hydrate();
    useStore.setState({ exercises: [SQUAT, BENCH] });
  });

  it("resolves a day key through the Monday-first rotation", () => {
    useStore.getState().setPlannedDay(0, { name: "Monday", exerciseIds: ["e_squat"] });
    useStore.getState().setPlannedDay(6, { name: "Sunday", exerciseIds: ["e_bench"] });

    // The off-by-one traps at both ends of the array: a Sunday-first index would
    // swap these two.
    expect(useStore.getState().plannedWorkoutForDate(MONDAY)?.name).toBe("Monday");
    expect(useStore.getState().plannedWorkoutForDate(SUNDAY)?.name).toBe("Sunday");
  });

  it("returns nothing on a rest day and with no plan at all", () => {
    expect(useStore.getState().plannedWorkoutForDate(WEDNESDAY)).toBeUndefined();
    useStore.getState().setPlannedDay(2, null);
    expect(useStore.getState().plannedWorkoutForDate(WEDNESDAY)).toBeUndefined();
  });

  it("drops a planned exercise that has since been deleted", () => {
    useStore
      .getState()
      .setPlannedDay(2, { name: "Squat day", exerciseIds: ["e_squat", "e_deleted"] });

    expect(useStore.getState().plannedWorkoutForDate(WEDNESDAY)).toEqual({
      name: "Squat day",
      exerciseIds: ["e_squat"],
    });
  });

  it("degrades to no plan when every planned exercise is gone", () => {
    useStore.getState().setPlannedDay(2, { name: "Ghost day", exerciseIds: ["e_deleted"] });

    // Not an empty workout: a day whose every lift has vanished is a day with
    // nothing to preload, and the UI should treat it exactly like an unplanned
    // one rather than opening a session with an empty prompt.
    expect(useStore.getState().plannedWorkoutForDate(WEDNESDAY)).toBeUndefined();
  });

  it("degrades to no plan for a malformed stored week instead of throwing", () => {
    useStore.setState({
      plannedWeek: [{ name: "Broken", exerciseIds: "e_squat" }] as unknown as PlannedWeek,
    });
    expect(() => useStore.getState().plannedWorkoutForDate(MONDAY)).not.toThrow();
    expect(useStore.getState().plannedWorkoutForDate(MONDAY)).toBeUndefined();
  });
});

describe("clearAllData", () => {
  it("resets the plan in both the store and IndexedDB", async () => {
    await useStore.getState().hydrate();
    useStore.getState().setPlannedDay(0, { name: "Monday", exerciseIds: ["e_squat"] });
    await flush();

    await useStore.getState().clearAllData();
    expect(useStore.getState().plannedWeek).toBeUndefined();
    // The DB half is the one that matters: leaving the old plan on disk while
    // the store says otherwise would resurrect it on the next reload.
    const settings = await storedSettings();
    // false, not absent: clearAllData writes the flag off explicitly, exactly
    // as it does for targetsEnabled/habitsEnabled/toolsEnabled beside it. The
    // plan itself does go away entirely, which is the half that matters.
    expect(settings?.plannedWeek).toBeUndefined();
    await reload();
    expect(useStore.getState().plannedWeek).toBeUndefined();
  });
});

describe("a planned week that is not empty", () => {
  it("round-trips through IndexedDB with every weekday intact", async () => {
    // The whole point of the feature in one assertion: a real template, written
    // day by day, read back after a restart.
    await useStore.getState().hydrate();
    const planned: PlannedWeek = emptyPlannedWeek();
    planned[0] = { name: "Heavy Bench", exerciseIds: ["e_bench"] };
    planned[2] = { name: "Squat", exerciseIds: ["e_squat"] };
    planned[4] = { name: "Deadlift", exerciseIds: ["e_squat", "e_bench"] };
    planned.forEach((day, i) => useStore.getState().setPlannedDay(i, day));
    await flush();

    await reload();

    expect(useStore.getState().plannedWeek).toEqual(planned);
  });
});
