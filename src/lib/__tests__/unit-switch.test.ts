import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore, type WorkoutSet } from "../store";

/**
 * What `setUnit` does to data that already exists.
 *
 * This file is a TRIPWIRE, not an endorsement. It pins the fact that switching
 * lbs/kg changes a label and converts nothing, which is a real hazard: no unit
 * is stored on a `WorkoutSet`, so a history spanning a switch holds numbers in
 * two units that nothing can tell apart. The long note on `setUnit` in store.ts
 * explains why neither available fix is safe to land by halves.
 *
 * WHEN THESE FAIL, someone is implementing that fix. Read the note first, then
 * make sure the change is complete rather than plausible: whichever scheme is
 * chosen, every reader that compares weights across time has to move with it
 * (pr.ts, exercise-history.ts, chart-math.ts, csv.ts, and the screens that
 * render a weight beside the global unit). Do not simply update these
 * expectations to match new behaviour.
 */

const DEFAULT_STATE = {
  unit: "lbs" as const,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
  habits: [],
  habitEntries: [],
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

function mkSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: "s1",
    sessionId: "sess1",
    exerciseId: "bench",
    weight: 225,
    reps: 5,
    loggedAt: 1_700_000_000_000,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE, hydrated: true });
});

describe("setUnit", () => {
  it("changes the unit and leaves every stored weight untouched", async () => {
    const logged = mkSet({ weight: 225 });
    useStore.setState({ sets: [logged] });
    await db.sets.put(logged);

    useStore.getState().setUnit("kg");
    await flush();

    expect(useStore.getState().unit).toBe("kg");
    // Not 102.06. The number is the number the user typed, and it now claims to
    // be kilos.
    expect(useStore.getState().sets[0].weight).toBe(225);
    expect((await db.sets.get("s1"))?.weight).toBe(225);
  });

  it("leaves bodyweight and cardio distance alone too", async () => {
    // Both carry the same implicit dependence on the global unit: bodyweight is
    // lbs/kg, distance is miles/km. A conversion that repaired sets and missed
    // these would trade one silent inconsistency for two.
    useStore.setState({
      dailyLogs: [{ date: "2026-03-01", bodyweight: 180 }],
      sessions: [
        {
          id: "c1",
          startedAt: 1_700_000_000_000,
          kind: "cardio",
          cardioExerciseId: "run",
          distance: 3.1,
        },
      ],
    });

    useStore.getState().setUnit("kg");
    await flush();

    expect(useStore.getState().dailyLogs[0].bodyweight).toBe(180);
    expect(useStore.getState().sessions[0].distance).toBe(3.1);
  });

  it("records no unit on a set, which is what makes the mixed history unfixable", () => {
    // The root cause, stated as an assertion so it is visible rather than
    // inferred: nothing on a logged set says what unit it was logged in, so a
    // set logged before a switch and one logged after are indistinguishable.
    // Fixing that is what stamping a `unit` field would mean.
    const set = mkSet();
    expect(set).not.toHaveProperty("unit");

    useStore.setState({ sets: [set] });
    useStore.getState().setUnit("kg");

    expect(useStore.getState().sets[0]).not.toHaveProperty("unit");
  });

  it("switching back and forth is currently lossless, and any fix must keep that", async () => {
    // The one property the do-nothing behaviour has going for it. A conversion
    // scheme that rounds to something displayable (100 kg -> 220.5 lb ->
    // 100.017 kg) loses this, and loses a little more on every toggle.
    const logged = mkSet({ weight: 62.5 });
    useStore.setState({ sets: [logged] });
    await db.sets.put(logged);

    useStore.getState().setUnit("kg");
    useStore.getState().setUnit("lbs");
    await flush();

    expect(useStore.getState().unit).toBe("lbs");
    expect(useStore.getState().sets[0].weight).toBe(62.5);
    expect((await db.sets.get("s1"))?.weight).toBe(62.5);
  });
});
