import { describe, expect, it } from "vitest";
import {
  computePrefill,
  isCardioSession,
  suggestNextExercise,
  type WorkoutSession,
  type WorkoutSet,
} from "../store";

/**
 * Cardio sessions share the `sessions` array with strength sessions, so every
 * strength heuristic has to filter them out. These cover the pure functions;
 * the store-action side (endWorkout / deleteSession / logCardio) lives in
 * cardio.store.test.ts.
 */

const t0 = 1_000_000;

describe("isCardioSession", () => {
  it("is true only for an explicit cardio kind", () => {
    expect(isCardioSession({ id: "c", startedAt: t0, kind: "cardio" })).toBe(true);
  });

  it("treats a missing kind as strength, so every pre-cardio record stays valid", () => {
    expect(isCardioSession({ id: "s", splitSlotId: "slotA", startedAt: t0 })).toBe(false);
  });

  it("treats an explicit strength kind as strength", () => {
    expect(
      isCardioSession({ id: "s", splitSlotId: "slotA", startedAt: t0, kind: "strength" }),
    ).toBe(false);
  });
});

describe("suggestNextExercise ignores cardio", () => {
  it("does not suggest a cardio exercise as the next lift", () => {
    // The exact failure this guards: log a treadmill run, then open a strength
    // session and get told to do Treadmill next.
    const sessions: WorkoutSession[] = [
      { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 5000 },
      {
        id: "run",
        startedAt: t0 + 8000,
        endedAt: t0 + 9000,
        kind: "cardio",
        cardioExerciseId: "treadmill",
        durationMinutes: 28,
      },
      { id: "today_a", splitSlotId: "slotA", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "past_a", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
      { id: "s2", sessionId: "past_a", exerciseId: "ex2", weight: 50, reps: 8, loggedAt: t0 + 20 },
    ];

    const sug = suggestNextExercise(sessions, sets, "today_a");
    expect(sug?.exerciseId).toBe("ex1");
    expect(sug?.exerciseId).not.toBe("treadmill");
  });

  it("returns undefined when asked about a cardio session itself", () => {
    const sessions: WorkoutSession[] = [
      { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 5000 },
      { id: "run", startedAt: t0 + 10_000, endedAt: t0 + 11_000, kind: "cardio" },
    ];
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "past_a", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
    ];
    expect(suggestNextExercise(sessions, sets, "run")).toBeUndefined();
  });

  it("does not match two cardio sessions to each other via their undefined splitSlotId", () => {
    // Both carry splitSlotId === undefined. A naive `a.splitSlotId === b.splitSlotId`
    // says they are the same slot, and the earlier run becomes "last time".
    const sessions: WorkoutSession[] = [
      {
        id: "run1",
        startedAt: t0,
        endedAt: t0 + 1000,
        kind: "cardio",
        cardioExerciseId: "treadmill",
      },
      {
        id: "run2",
        startedAt: t0 + 5000,
        endedAt: t0 + 6000,
        kind: "cardio",
        cardioExerciseId: "bike",
      },
    ];
    // Sets should never exist on a cardio session, but plant one anyway: if the
    // matching leaks, this is what would get suggested.
    const sets: WorkoutSet[] = [
      {
        id: "x1",
        sessionId: "run1",
        exerciseId: "treadmill",
        weight: 0,
        reps: 0,
        loggedAt: t0 + 1,
      },
    ];
    expect(suggestNextExercise(sessions, sets, "run2")).toBeUndefined();
  });

  it("ignores a cardio session even when it does carry a splitSlotId", () => {
    // parseBackup accepts kind:"cardio" alongside a splitSlotId (the two fields
    // are validated independently), so a hand-edited or future-format file can
    // produce this. `kind` has to be what excludes it, not the absent slot.
    const sessions: WorkoutSession[] = [
      { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 5000 },
      {
        id: "run",
        splitSlotId: "slotA",
        startedAt: t0 + 8000,
        endedAt: t0 + 9000,
        kind: "cardio",
        cardioExerciseId: "treadmill",
      },
      { id: "today_a", splitSlotId: "slotA", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "past_a", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
      // Attributed to the run, and more recent: what would win if it leaked.
      {
        id: "r1",
        sessionId: "run",
        exerciseId: "treadmill",
        weight: 0,
        reps: 0,
        loggedAt: t0 + 8010,
      },
    ];
    expect(suggestNextExercise(sessions, sets, "today_a")?.exerciseId).toBe("ex1");
  });

  it("still works normally when cardio sessions are absent", () => {
    const sessions: WorkoutSession[] = [
      { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 5000 },
      { id: "today_a", splitSlotId: "slotA", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "past_a", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
    ];
    expect(suggestNextExercise(sessions, sets, "today_a")?.exerciseId).toBe("ex1");
  });
});

describe("computePrefill ignores cardio", () => {
  it("does not prefill weights from a cardio session", () => {
    const sessions: WorkoutSession[] = [
      { id: "prev", splitSlotId: "slotH", startedAt: t0, endedAt: t0 + 5000 },
      // Logged more recently than `prev`; if it were eligible it would win the sort.
      {
        id: "run",
        startedAt: t0 + 8000,
        endedAt: t0 + 9000,
        kind: "cardio",
        cardioExerciseId: "bench",
        distance: 3.1,
      },
      { id: "today", splitSlotId: "slotH", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "p1", sessionId: "prev", exerciseId: "bench", weight: 225, reps: 1, loggedAt: t0 + 10 },
      // A stray set attributed to the run: only reachable if the guard fails.
      { id: "r1", sessionId: "run", exerciseId: "bench", weight: 5, reps: 99, loggedAt: t0 + 8010 },
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 1,
      rpe: undefined,
    });
  });

  it("returns {} when asked about a cardio session itself", () => {
    const sessions: WorkoutSession[] = [
      { id: "prev", splitSlotId: "slotH", startedAt: t0, endedAt: t0 + 5000 },
      { id: "run", startedAt: t0 + 10_000, endedAt: t0 + 11_000, kind: "cardio" },
    ];
    const sets: WorkoutSet[] = [
      { id: "p1", sessionId: "prev", exerciseId: "bench", weight: 225, reps: 1, loggedAt: t0 + 10 },
    ];
    expect(computePrefill(sessions, sets, "run", "bench")).toEqual({});
  });

  it("does not match two cardio sessions to each other via their undefined splitSlotId", () => {
    const sessions: WorkoutSession[] = [
      { id: "run1", startedAt: t0, endedAt: t0 + 1000, kind: "cardio" },
      { id: "run2", startedAt: t0 + 5000, endedAt: t0 + 6000, kind: "cardio" },
    ];
    const sets: WorkoutSet[] = [
      { id: "x1", sessionId: "run1", exerciseId: "bench", weight: 400, reps: 1, loggedAt: t0 + 1 },
    ];
    expect(computePrefill(sessions, sets, "run2", "bench")).toEqual({});
  });

  it("ignores a cardio session even when it does carry a splitSlotId", () => {
    // See the matching suggestNextExercise case: kind must be what excludes it.
    const sessions: WorkoutSession[] = [
      { id: "prev", splitSlotId: "slotH", startedAt: t0, endedAt: t0 + 5000 },
      {
        id: "run",
        splitSlotId: "slotH",
        startedAt: t0 + 8000,
        endedAt: t0 + 9000,
        kind: "cardio",
      },
      { id: "today", splitSlotId: "slotH", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "p1", sessionId: "prev", exerciseId: "bench", weight: 225, reps: 1, loggedAt: t0 + 10 },
      { id: "r1", sessionId: "run", exerciseId: "bench", weight: 5, reps: 99, loggedAt: t0 + 8010 },
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 1,
      rpe: undefined,
    });
  });
});

describe("sessions with no kind field behave exactly as strength", () => {
  const withoutKind: WorkoutSession[] = [
    { id: "prev", splitSlotId: "slotH", startedAt: t0, endedAt: t0 + 5000 },
    { id: "today", splitSlotId: "slotH", startedAt: t0 + 10_000 },
  ];
  const withExplicitKind: WorkoutSession[] = withoutKind.map((s) => ({
    ...s,
    kind: "strength" as const,
  }));
  const sets: WorkoutSet[] = [
    { id: "p1", sessionId: "prev", exerciseId: "bench", weight: 225, reps: 1, loggedAt: t0 + 10 },
    { id: "p2", sessionId: "prev", exerciseId: "row", weight: 90, reps: 10, loggedAt: t0 + 20 },
  ];

  it("suggests identically with and without an explicit kind", () => {
    expect(suggestNextExercise(withoutKind, sets, "today")).toEqual(
      suggestNextExercise(withExplicitKind, sets, "today"),
    );
    expect(suggestNextExercise(withoutKind, sets, "today")?.exerciseId).toBe("bench");
  });

  it("prefills identically with and without an explicit kind", () => {
    expect(computePrefill(withoutKind, sets, "today", "bench")).toEqual(
      computePrefill(withExplicitKind, sets, "today", "bench"),
    );
    expect(computePrefill(withoutKind, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 1,
      rpe: undefined,
    });
  });
});
