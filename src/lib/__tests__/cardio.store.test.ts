import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { isCardioSession, useStore, type WorkoutSession } from "../store";

/**
 * Store-level cardio behaviour: the one-shot logCardio action, and the guards
 * that keep a cardio session invisible to the rotation / suggestion engine.
 * The pure-function half lives in cardio.pure.test.ts.
 */

const DEFAULT_STATE = {
  unit: "lbs" as const,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
  activeSessionId: undefined,
  currentExerciseId: undefined,
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

beforeEach(async () => {
  await resetDb();
  useStore.setState({ ...DEFAULT_STATE, hydrated: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function sessionById(id: string): WorkoutSession | undefined {
  return useStore.getState().sessions.find((s) => s.id === id);
}

describe("logCardio", () => {
  it("back-computes startedAt from the duration", () => {
    // The scenario from the spec: a 28 minute entry saved at 08:30 must record
    // startedAt 08:02.
    const savedAt = new Date("2026-08-07T08:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(savedAt);

    const id = useStore.getState().logCardio({ exerciseId: "treadmill", durationMinutes: 28 });
    const sess = sessionById(id)!;

    expect(sess.endedAt).toBe(savedAt.getTime());
    expect(new Date(sess.startedAt).toISOString()).toBe("2026-08-07T08:02:00.000Z");
    expect(sess.endedAt! - sess.startedAt).toBe(28 * 60_000);
  });

  it("sets startedAt equal to endedAt when no duration is given", () => {
    const id = useStore.getState().logCardio({ exerciseId: "treadmill", distance: 3.1 });
    const sess = sessionById(id)!;

    expect(sess.startedAt).toBe(sess.endedAt);
    expect(sess.durationMinutes).toBeUndefined();
    expect(sess.distance).toBe(3.1);
  });

  it("lands a backdated bout on the requested day at midday", () => {
    // Backdating sets endedAt to midday local time on the target date, and
    // back-computes startedAt from the duration.
    const on = "2026-08-01";
    const id = useStore.getState().logCardio({
      exerciseId: "treadmill",
      durationMinutes: 30,
      on,
    });
    const sess = sessionById(id)!;

    const expectedEndedAt = new Date(2026, 7, 1, 12, 0, 0, 0).getTime();
    expect(sess.endedAt).toBe(expectedEndedAt);
    expect(sess.startedAt).toBe(expectedEndedAt - 30 * 60_000);
  });

  it("creates a completed cardio session with no split slot and no sets", () => {
    const setsBefore = useStore.getState().sets.length;
    const id = useStore.getState().logCardio({
      exerciseId: "treadmill",
      durationMinutes: 30,
      distance: 3.1,
      setupNote: "incline 2",
    });
    const sess = sessionById(id)!;

    expect(isCardioSession(sess)).toBe(true);
    expect(sess.kind).toBe("cardio");
    expect(sess.splitSlotId).toBeUndefined();
    expect(sess.cardioExerciseId).toBe("treadmill");
    expect(sess.setupNote).toBe("incline 2");
    expect(sess.endedAt).toBeDefined();
    expect(useStore.getState().sets.length).toBe(setsBefore);
  });

  it("stores a blank setup note as undefined rather than an empty string", () => {
    const id = useStore.getState().logCardio({ exerciseId: "treadmill", setupNote: "   " });
    expect(sessionById(id)!.setupNote).toBeUndefined();
  });

  it("never puts the app into workout mode", () => {
    useStore.getState().logCardio({ exerciseId: "treadmill", durationMinutes: 20 });
    const state = useStore.getState();

    expect(state.activeSessionId).toBeUndefined();
    expect(state.currentExerciseId).toBeUndefined();
  });

  it("does not disturb an in-progress strength workout", () => {
    useStore.setState({ slots: [{ id: "slotA", name: "Heavy Bench", rotationOrder: 0 }] });
    const activeId = useStore.getState().startWorkout("Heavy Bench");
    useStore.getState().setCurrentExercise("bench");

    useStore.getState().logCardio({ exerciseId: "treadmill", durationMinutes: 20 });

    expect(useStore.getState().activeSessionId).toBe(activeId);
    expect(useStore.getState().currentExerciseId).toBe("bench");
  });

  it("writes through to IndexedDB", async () => {
    const id = useStore.getState().logCardio({
      exerciseId: "treadmill",
      durationMinutes: 28,
      distance: 3.1,
    });
    await flush();

    const stored = await db.sessions.get(id);
    expect(stored).toMatchObject({
      id,
      kind: "cardio",
      cardioExerciseId: "treadmill",
      durationMinutes: 28,
      distance: 3.1,
    });
    expect(stored?.splitSlotId).toBeUndefined();
  });

  it("survives a reload with its fields intact", async () => {
    // Hydrate first so the DB is genuinely populated. hydrate() re-seeds the
    // exercise library whenever the exercises table is empty, which would
    // otherwise blow away the session written below.
    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();

    const id = useStore.getState().logCardio({
      exerciseId: "treadmill",
      durationMinutes: 28,
      distance: 3.1,
      setupNote: "incline 2",
    });
    const before = sessionById(id)!;
    await flush();

    useStore.setState({ ...DEFAULT_STATE, hydrated: false });
    await useStore.getState().hydrate();

    expect(sessionById(id)).toEqual(before);
  });
});

describe("cardio does not touch the split", () => {
  const slots = [
    { id: "slotA", name: "Heavy Bench", rotationOrder: 0, lastLoggedAt: 1000 },
    { id: "slotB", name: "Squat", rotationOrder: 1 },
    { id: "slotC", name: "Volume Bench", rotationOrder: 2 },
  ];

  it("logging cardio leaves every slot's lastLoggedAt untouched", () => {
    useStore.setState({ slots });
    useStore.getState().logCardio({ exerciseId: "treadmill", durationMinutes: 45 });

    expect(useStore.getState().slots).toEqual(slots);
  });

  it("logging cardio does not move the split cursor", () => {
    // A cardio bout has no split slot, so there is no card for it to consume.
    // The cursor is explicit now rather than derived from lastLoggedAt, which
    // makes this a claim about endWorkout leaving it alone.
    useStore.setState({ slots, nextSlotId: "slotB" });
    expect(useStore.getState().predictedNextSlotName()).toBe("Squat");

    useStore.getState().logCardio({ exerciseId: "treadmill", durationMinutes: 45 });

    expect(useStore.getState().nextSlotId).toBe("slotB");
    expect(useStore.getState().predictedNextSlotName()).toBe("Squat");
  });

  it("endWorkout is a no-op on slots for a cardio session set active by hand", () => {
    // logCardio never sets activeSessionId, so this cannot happen through the
    // UI. Forcing it proves the guard is in endWorkout itself, not just in the
    // fact that cardio never becomes active.
    const cardio: WorkoutSession = {
      id: "run",
      startedAt: 5000,
      kind: "cardio",
      cardioExerciseId: "treadmill",
    };
    useStore.setState({ slots, sessions: [cardio], activeSessionId: "run" });

    useStore.getState().endWorkout();

    expect(useStore.getState().slots).toEqual(slots);
    expect(sessionById("run")?.endedAt).toBeDefined(); // the session still ends
    expect(useStore.getState().activeSessionId).toBeUndefined();
  });

  it("endWorkout is a no-op on slots for a cardio session that does carry a splitSlotId", () => {
    // parseBackup validates kind and splitSlotId independently, so an imported
    // file can hold a cardio session with a slot attached. `kind` must be what
    // stops it stamping lastLoggedAt, not merely the slot being absent.
    const cardio: WorkoutSession = {
      id: "run",
      splitSlotId: "slotA",
      startedAt: 5000,
      kind: "cardio",
      cardioExerciseId: "treadmill",
    };
    useStore.setState({ slots, sessions: [cardio], activeSessionId: "run" });

    useStore.getState().endWorkout();

    expect(useStore.getState().slots).toEqual(slots);
    expect(useStore.getState().slots[0].lastLoggedAt).toBe(1000); // unchanged
  });

  it("endWorkout is a no-op on slots for a session with no splitSlotId at all", () => {
    const orphan: WorkoutSession = { id: "orphan", startedAt: 5000 };
    useStore.setState({ slots, sessions: [orphan], activeSessionId: "orphan" });

    useStore.getState().endWorkout();

    expect(useStore.getState().slots).toEqual(slots);
  });

  it("still stamps lastLoggedAt for a normal strength workout", () => {
    useStore.setState({ slots });
    useStore.getState().startWorkout("Squat");
    useStore.getState().endWorkout();

    const slotB = useStore.getState().slots.find((s) => s.id === "slotB")!;
    expect(slotB.lastLoggedAt).toBeDefined();
    expect(useStore.getState().predictedNextSlotName()).toBe("Volume Bench");
  });
});

describe("deleteSession recomputes lastLoggedAt from strength sessions only", () => {
  const slots = [{ id: "slotA", name: "Heavy Bench", rotationOrder: 0, lastLoggedAt: 3000 }];

  it("falls back to the previous strength session for the same slot", () => {
    const sessions: WorkoutSession[] = [
      { id: "old", splitSlotId: "slotA", startedAt: 1000, endedAt: 2000 },
      { id: "new", splitSlotId: "slotA", startedAt: 2500, endedAt: 3000 },
      // Ends LATER than either. If cardio leaked into the recomputation it
      // would win the Math.max and set a bogus lastLoggedAt.
      { id: "run", startedAt: 9000, endedAt: 9500, kind: "cardio", cardioExerciseId: "treadmill" },
    ];
    useStore.setState({ slots, sessions });

    useStore.getState().deleteSession("new");

    expect(useStore.getState().slots[0].lastLoggedAt).toBe(2000);
  });

  it("excludes a cardio session that does carry the same splitSlotId", () => {
    const sessions: WorkoutSession[] = [
      { id: "old", splitSlotId: "slotA", startedAt: 1000, endedAt: 2000 },
      { id: "new", splitSlotId: "slotA", startedAt: 2500, endedAt: 3000 },
      // Same slot AND a later endedAt. Only the kind check excludes it.
      {
        id: "run",
        splitSlotId: "slotA",
        startedAt: 9000,
        endedAt: 9500,
        kind: "cardio",
        cardioExerciseId: "treadmill",
      },
    ];
    useStore.setState({ slots, sessions });

    useStore.getState().deleteSession("new");

    expect(useStore.getState().slots[0].lastLoggedAt).toBe(2000);
  });

  it("deleting a cardio session that carries a splitSlotId leaves that slot alone", () => {
    const sessions: WorkoutSession[] = [
      { id: "strength", splitSlotId: "slotA", startedAt: 2500, endedAt: 3000 },
      { id: "run", splitSlotId: "slotA", startedAt: 9000, endedAt: 9500, kind: "cardio" },
    ];
    useStore.setState({ slots, sessions });

    useStore.getState().deleteSession("run");

    // lastLoggedAt stays at its original 3000 rather than being recomputed.
    expect(useStore.getState().slots).toEqual(slots);
  });

  it("clears lastLoggedAt when the only remaining sessions for the slot are cardio", () => {
    const sessions: WorkoutSession[] = [
      { id: "only", splitSlotId: "slotA", startedAt: 2500, endedAt: 3000 },
      { id: "run", startedAt: 9000, endedAt: 9500, kind: "cardio" },
    ];
    useStore.setState({ slots, sessions });

    useStore.getState().deleteSession("only");

    expect(useStore.getState().slots[0].lastLoggedAt).toBeUndefined();
  });

  it("deleting a cardio session leaves every slot alone", () => {
    const sessions: WorkoutSession[] = [
      { id: "strength", splitSlotId: "slotA", startedAt: 2500, endedAt: 3000 },
      { id: "run", startedAt: 9000, endedAt: 9500, kind: "cardio" },
    ];
    useStore.setState({ slots, sessions });

    useStore.getState().deleteSession("run");

    expect(useStore.getState().slots).toEqual(slots);
    expect(useStore.getState().sessions.map((s) => s.id)).toEqual(["strength"]);
  });

  it("removes the cardio session from IndexedDB too", async () => {
    const id = useStore.getState().logCardio({ exerciseId: "treadmill", durationMinutes: 28 });
    await flush();
    expect(await db.sessions.get(id)).toBeDefined();

    useStore.getState().deleteSession(id);
    await flush();

    expect(await db.sessions.get(id)).toBeUndefined();
  });

  it("treats a session with no kind exactly as strength when recomputing", () => {
    // Same data as the first case but with kind spelled out on the strength
    // rows; the result must be identical to the implicit version.
    const sessions: WorkoutSession[] = [
      { id: "old", splitSlotId: "slotA", startedAt: 1000, endedAt: 2000, kind: "strength" },
      { id: "new", splitSlotId: "slotA", startedAt: 2500, endedAt: 3000, kind: "strength" },
      { id: "run", startedAt: 9000, endedAt: 9500, kind: "cardio" },
    ];
    useStore.setState({ slots, sessions });

    useStore.getState().deleteSession("new");

    expect(useStore.getState().slots[0].lastLoggedAt).toBe(2000);
  });
});

describe("end-to-end: a logged run never becomes a lift suggestion", () => {
  it("does not suggest or prefill from cardio after a real logCardio call", () => {
    useStore.setState({
      slots: [{ id: "slotA", name: "Heavy Bench", rotationOrder: 0 }],
      sessions: [{ id: "past", splitSlotId: "slotA", startedAt: 1000, endedAt: 2000 }],
      sets: [
        { id: "p1", sessionId: "past", exerciseId: "bench", weight: 225, reps: 3, loggedAt: 1010 },
      ],
    });

    // Log a treadmill run, then start today's Heavy Bench.
    useStore.getState().logCardio({ exerciseId: "treadmill", durationMinutes: 28, distance: 3.1 });
    const todayId = useStore.getState().startWorkout("Heavy Bench");

    const sug = useStore.getState().suggestedNextExerciseFor(todayId);
    expect(sug?.exerciseId).toBe("bench");
    expect(sug?.exerciseId).not.toBe("treadmill");

    expect(useStore.getState().prefillFor(todayId, "bench")).toEqual({
      weight: 225,
      reps: 3,
      rpe: undefined,
    });
  });
});
