import { describe, expect, it } from "vitest";
import {
  bestSetFor,
  groupSetsBySession,
  previousSessionExerciseOrder,
  setsForExercise,
  volumeFor,
} from "../exercise-history";
import type { WorkoutSession, WorkoutSet } from "../store";

const t0 = 1_000_000;

describe("setsForExercise", () => {
  it("filters sets by exerciseId and sorts newest first", () => {
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 },
      { id: "s2", sessionId: "sess1", exerciseId: "ex2", weight: 50, reps: 10, loggedAt: t0 + 10 },
      { id: "s3", sessionId: "sess2", exerciseId: "ex1", weight: 110, reps: 5, loggedAt: t0 + 200 },
    ];
    // Both strength: `sessions` is a required argument precisely so a set can
    // never be counted without its session having been confirmed non-cardio.
    const sessions: WorkoutSession[] = [
      { id: "sess1", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 100 },
      { id: "sess2", splitSlotId: "slotA", startedAt: t0 + 150, endedAt: t0 + 300 },
    ];

    const result = setsForExercise(sets, "ex1", sessions);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("s3");
    expect(result[1].id).toBe("s1");
  });

  it("excludes sets belonging to cardio sessions when sessions list is provided", () => {
    const sessions: WorkoutSession[] = [
      { id: "sess1", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 1000 },
      { id: "run1", startedAt: t0 + 2000, endedAt: t0 + 3000, kind: "cardio" },
    ];

    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
      { id: "s2", sessionId: "run1", exerciseId: "ex1", weight: 0, reps: 0, loggedAt: t0 + 2010 },
    ];

    const result = setsForExercise(sets, "ex1", sessions);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });

  it("returns nothing when the sessions list is empty, rather than skipping the guard", () => {
    // An earlier signature made `sessions` optional and additionally bailed out
    // of filtering on `sessions.length === 0`, so an empty array silently meant
    // "no cardio anywhere, let everything through". A set whose session is
    // unknown must be excluded, not trusted.
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 },
    ];

    expect(setsForExercise(sets, "ex1", [])).toEqual([]);
  });

  it("excludes orphan sets whose session is missing from the sessions list", () => {
    const sessions: WorkoutSession[] = [
      { id: "sess1", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 100 },
    ];
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 },
      {
        id: "orphan",
        sessionId: "gone",
        exerciseId: "ex1",
        weight: 999,
        reps: 1,
        loggedAt: t0 + 5,
      },
    ];

    const result = setsForExercise(sets, "ex1", sessions);
    expect(result.map((s) => s.id)).toEqual(["s1"]);
  });

  it("treats a session with no `kind` as strength, so pre-cardio records survive", () => {
    // Every session recorded before cardio existed has no `kind` field at all.
    // If absent read as anything other than strength, all of that history would
    // vanish from this screen.
    const sessions: WorkoutSession[] = [
      { id: "legacy", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 100 },
      {
        id: "explicit",
        splitSlotId: "slotA",
        startedAt: t0 + 200,
        endedAt: t0 + 300,
        kind: "strength",
      },
    ];
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "legacy", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
      {
        id: "s2",
        sessionId: "explicit",
        exerciseId: "ex1",
        weight: 105,
        reps: 5,
        loggedAt: t0 + 210,
      },
    ];

    expect(setsForExercise(sets, "ex1", sessions).map((s) => s.id)).toEqual(["s2", "s1"]);
  });
});

describe("cardio exclusion through the bestSetFor / volumeFor pipeline", () => {
  // bestSetFor and volumeFor take sets, so they cannot guard themselves. What
  // has to hold is that the ONLY supported way to get sets for an exercise
  // already excludes cardio, so neither a personal best nor a volume total can
  // pick one up.
  const sessions: WorkoutSession[] = [
    { id: "lift", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
    {
      id: "run",
      startedAt: t0 + 5000,
      endedAt: t0 + 6000,
      kind: "cardio",
      cardioExerciseId: "ex1",
    },
  ];

  // The cardio "set" is heavier and higher-volume than anything real, so it
  // would dominate both aggregates if it leaked through.
  const sets: WorkoutSet[] = [
    { id: "real", sessionId: "lift", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
    {
      id: "bogus",
      sessionId: "run",
      exerciseId: "ex1",
      weight: 500,
      reps: 20,
      loggedAt: t0 + 5010,
    },
  ];

  it("keeps a cardio-attached set out of the best set", () => {
    const best = bestSetFor(setsForExercise(sets, "ex1", sessions));
    expect(best?.id).toBe("real");
  });

  it("keeps a cardio-attached set out of the volume total", () => {
    expect(volumeFor(setsForExercise(sets, "ex1", sessions))).toBe(500);
  });

  it("keeps a cardio session out of the history timeline", () => {
    const grouped = groupSetsBySession(setsForExercise(sets, "ex1", sessions), sessions);
    expect(grouped.map((g) => g.session.id)).toEqual(["lift"]);
  });
});

describe("groupSetsBySession", () => {
  it("groups sets by strength session newest session first, with sets in logged order", () => {
    const sessions: WorkoutSession[] = [
      { id: "sess1", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
      { id: "sess2", splitSlotId: "slotA", startedAt: t0 + 86400, endedAt: t0 + 90000 },
    ];

    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 200, reps: 5, loggedAt: t0 + 10 },
      { id: "s2", sessionId: "sess1", exerciseId: "ex1", weight: 225, reps: 3, loggedAt: t0 + 20 },
      {
        id: "s3",
        sessionId: "sess2",
        exerciseId: "ex1",
        weight: 230,
        reps: 2,
        loggedAt: t0 + 86410,
      },
    ];

    const grouped = groupSetsBySession(sets, sessions);
    expect(grouped).toHaveLength(2);

    // Newest session first
    expect(grouped[0].session.id).toBe("sess2");
    expect(grouped[0].sets).toHaveLength(1);
    expect(grouped[0].sets[0].id).toBe("s3");

    // Earlier session second, sets in logged order
    expect(grouped[1].session.id).toBe("sess1");
    expect(grouped[1].sets).toHaveLength(2);
    expect(grouped[1].sets[0].id).toBe("s1");
    expect(grouped[1].sets[1].id).toBe("s2");
  });

  it("ignores cardio sessions", () => {
    const sessions: WorkoutSession[] = [
      { id: "sess1", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
      { id: "run1", startedAt: t0 + 5000, endedAt: t0 + 6000, kind: "cardio" },
    ];

    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 200, reps: 5, loggedAt: t0 + 10 },
      { id: "s2", sessionId: "run1", exerciseId: "ex1", weight: 0, reps: 0, loggedAt: t0 + 5010 },
    ];

    const grouped = groupSetsBySession(sets, sessions);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].session.id).toBe("sess1");
  });
});

describe("bestSetFor", () => {
  it("returns undefined for an empty set list", () => {
    expect(bestSetFor([])).toBeUndefined();
  });

  it("returns the set with highest weight", () => {
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 200, reps: 5, loggedAt: t0 },
      { id: "s2", sessionId: "sess1", exerciseId: "ex1", weight: 225, reps: 3, loggedAt: t0 + 10 },
      { id: "s3", sessionId: "sess1", exerciseId: "ex1", weight: 215, reps: 5, loggedAt: t0 + 20 },
    ];

    expect(bestSetFor(sets)?.id).toBe("s2");
  });

  it("breaks ties by higher reps when weight is identical", () => {
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 225, reps: 3, loggedAt: t0 },
      { id: "s2", sessionId: "sess1", exerciseId: "ex1", weight: 225, reps: 5, loggedAt: t0 + 10 },
      { id: "s3", sessionId: "sess1", exerciseId: "ex1", weight: 225, reps: 4, loggedAt: t0 + 20 },
    ];

    expect(bestSetFor(sets)?.id).toBe("s2");
  });
});

describe("volumeFor", () => {
  it("returns 0 for an empty set list", () => {
    expect(volumeFor([])).toBe(0);
  });

  it("sums weight * reps for all sets", () => {
    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "sess1", exerciseId: "ex1", weight: 100, reps: 10, loggedAt: t0 }, // 1000
      { id: "s2", sessionId: "sess1", exerciseId: "ex1", weight: 200, reps: 5, loggedAt: t0 + 10 }, // 1000
    ];

    expect(volumeFor(sets)).toBe(2000);
  });
});

describe("previousSessionExerciseOrder", () => {
  it("returns unique exercise IDs from the previous session of the same split slot in logged order", () => {
    const sessions: WorkoutSession[] = [
      { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
      { id: "today_a", splitSlotId: "slotA", startedAt: t0 + 86400 },
    ];

    const sets: WorkoutSet[] = [
      {
        id: "s1",
        sessionId: "past_a",
        exerciseId: "squat",
        weight: 225,
        reps: 5,
        loggedAt: t0 + 10,
      },
      {
        id: "s2",
        sessionId: "past_a",
        exerciseId: "squat",
        weight: 245,
        reps: 5,
        loggedAt: t0 + 20,
      },
      {
        id: "s3",
        sessionId: "past_a",
        exerciseId: "leg_press",
        weight: 400,
        reps: 10,
        loggedAt: t0 + 30,
      },
      {
        id: "s4",
        sessionId: "past_a",
        exerciseId: "calf_raise",
        weight: 150,
        reps: 12,
        loggedAt: t0 + 40,
      },
    ];

    const order = previousSessionExerciseOrder(sessions, sets, "today_a");
    expect(order).toEqual(["squat", "leg_press", "calf_raise"]);
  });

  it("excludes cardio sessions from matching", () => {
    const sessions: WorkoutSession[] = [
      { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
      {
        id: "run1",
        startedAt: t0 + 10000,
        endedAt: t0 + 12000,
        kind: "cardio",
        cardioExerciseId: "run",
      },
      { id: "today_a", splitSlotId: "slotA", startedAt: t0 + 86400 },
    ];

    const sets: WorkoutSet[] = [
      {
        id: "s1",
        sessionId: "past_a",
        exerciseId: "bench",
        weight: 200,
        reps: 5,
        loggedAt: t0 + 10,
      },
      { id: "r1", sessionId: "run1", exerciseId: "run", weight: 0, reps: 0, loggedAt: t0 + 10010 },
    ];

    const order = previousSessionExerciseOrder(sessions, sets, "today_a");
    expect(order).toEqual(["bench"]);
  });

  it("does not match two sessions with null/undefined splitSlotId to each other", () => {
    const sessions: WorkoutSession[] = [
      { id: "cardio1", startedAt: t0, endedAt: t0 + 1000, kind: "cardio" },
      { id: "cardio2", startedAt: t0 + 5000, endedAt: t0 + 6000, kind: "cardio" },
      { id: "custom1", startedAt: t0 + 10000, endedAt: t0 + 11000 },
      { id: "custom2", startedAt: t0 + 20000 },
    ];

    const sets: WorkoutSet[] = [
      {
        id: "s1",
        sessionId: "custom1",
        exerciseId: "curl",
        weight: 30,
        reps: 10,
        loggedAt: t0 + 10010,
      },
    ];

    expect(previousSessionExerciseOrder(sessions, sets, "custom2")).toEqual([]);
    expect(previousSessionExerciseOrder(sessions, sets, "cardio2")).toEqual([]);
  });

  it("returns empty array if no previous session exists for the slot", () => {
    const sessions: WorkoutSession[] = [{ id: "first_a", splitSlotId: "slotA", startedAt: t0 }];

    expect(previousSessionExerciseOrder(sessions, [], "first_a")).toEqual([]);
  });

  it("never reaches forwards in time, even when the later session is the finished one", () => {
    // `/session/$id` renders the same SessionView as `/workout`, so this is
    // called for sessions being VIEWED, not only for the live one. Opening the
    // EARLIER of two finished sessions must not offer the later one's exercises.
    const sessions: WorkoutSession[] = [
      { id: "week1", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
      { id: "week2", splitSlotId: "slotA", startedAt: t0 + 604_800, endedAt: t0 + 608_400 },
    ];

    const sets: WorkoutSet[] = [
      {
        id: "s1",
        sessionId: "week1",
        exerciseId: "squat",
        weight: 225,
        reps: 5,
        loggedAt: t0 + 10,
      },
      {
        id: "s2",
        sessionId: "week2",
        exerciseId: "deadlift",
        weight: 315,
        reps: 5,
        loggedAt: t0 + 604_810,
      },
    ];

    // Viewing the earlier session: there is nothing before it.
    expect(previousSessionExerciseOrder(sessions, sets, "week1")).toEqual([]);
    // Viewing the later one still looks backwards correctly.
    expect(previousSessionExerciseOrder(sessions, sets, "week2")).toEqual(["squat"]);
  });

  it("picks the most recent earlier session by startedAt, not by endedAt", () => {
    // `late_start` began after `long_run` but finished first. Ordering on
    // endedAt would pick `long_run`; every date-bucketing surface in the app
    // orders on startedAt, so the answer has to be `late_start`.
    const sessions: WorkoutSession[] = [
      { id: "long_run", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 20_000 },
      { id: "late_start", splitSlotId: "slotA", startedAt: t0 + 5_000, endedAt: t0 + 9_000 },
      { id: "current", splitSlotId: "slotA", startedAt: t0 + 50_000 },
    ];

    const sets: WorkoutSet[] = [
      {
        id: "s1",
        sessionId: "long_run",
        exerciseId: "squat",
        weight: 225,
        reps: 5,
        loggedAt: t0 + 10,
      },
      {
        id: "s2",
        sessionId: "late_start",
        exerciseId: "bench",
        weight: 185,
        reps: 5,
        loggedAt: t0 + 5_010,
      },
    ];

    expect(previousSessionExerciseOrder(sessions, sets, "current")).toEqual(["bench"]);
  });

  it("skips an abandoned (never-ended) earlier session", () => {
    // Matches store.ts's `findLastSessionForSlot`, which also requires endedAt:
    // a workout the user walked away from is not a plan worth repeating.
    const sessions: WorkoutSession[] = [
      { id: "finished", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
      { id: "abandoned", splitSlotId: "slotA", startedAt: t0 + 10_000 },
      { id: "current", splitSlotId: "slotA", startedAt: t0 + 50_000 },
    ];

    const sets: WorkoutSet[] = [
      {
        id: "s1",
        sessionId: "finished",
        exerciseId: "squat",
        weight: 225,
        reps: 5,
        loggedAt: t0 + 10,
      },
      {
        id: "s2",
        sessionId: "abandoned",
        exerciseId: "curl",
        weight: 30,
        reps: 10,
        loggedAt: t0 + 10_010,
      },
    ];

    expect(previousSessionExerciseOrder(sessions, sets, "current")).toEqual(["squat"]);
  });

  it("never pulls from a slot-less session into a slotted one", () => {
    const sessions: WorkoutSession[] = [
      { id: "slotless", startedAt: t0, endedAt: t0 + 3600 },
      { id: "current", splitSlotId: "slotA", startedAt: t0 + 50_000 },
    ];

    const sets: WorkoutSet[] = [
      {
        id: "s1",
        sessionId: "slotless",
        exerciseId: "curl",
        weight: 30,
        reps: 10,
        loggedAt: t0 + 10,
      },
    ];

    expect(previousSessionExerciseOrder(sessions, sets, "current")).toEqual([]);
  });
});
