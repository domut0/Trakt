import { describe, expect, it } from "vitest";
import { bestSetFor, groupSetsBySession, setsForExercise, volumeFor } from "../exercise-history";
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
