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
      { id: "s3", sessionId: "sess2", exerciseId: "ex1", weight: 230, reps: 2, loggedAt: t0 + 86410 },
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
      { id: "s1", sessionId: "past_a", exerciseId: "squat", weight: 225, reps: 5, loggedAt: t0 + 10 },
      { id: "s2", sessionId: "past_a", exerciseId: "squat", weight: 245, reps: 5, loggedAt: t0 + 20 },
      { id: "s3", sessionId: "past_a", exerciseId: "leg_press", weight: 400, reps: 10, loggedAt: t0 + 30 },
      { id: "s4", sessionId: "past_a", exerciseId: "calf_raise", weight: 150, reps: 12, loggedAt: t0 + 40 },
    ];

    const order = previousSessionExerciseOrder(sessions, sets, "today_a");
    expect(order).toEqual(["squat", "leg_press", "calf_raise"]);
  });

  it("excludes cardio sessions from matching", () => {
    const sessions: WorkoutSession[] = [
      { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 3600 },
      { id: "run1", startedAt: t0 + 10000, endedAt: t0 + 12000, kind: "cardio", cardioExerciseId: "run" },
      { id: "today_a", splitSlotId: "slotA", startedAt: t0 + 86400 },
    ];

    const sets: WorkoutSet[] = [
      { id: "s1", sessionId: "past_a", exerciseId: "bench", weight: 200, reps: 5, loggedAt: t0 + 10 },
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
      { id: "s1", sessionId: "custom1", exerciseId: "curl", weight: 30, reps: 10, loggedAt: t0 + 10010 },
    ];

    expect(previousSessionExerciseOrder(sessions, sets, "custom2")).toEqual([]);
    expect(previousSessionExerciseOrder(sessions, sets, "cardio2")).toEqual([]);
  });

  it("returns empty array if no previous session exists for the slot", () => {
    const sessions: WorkoutSession[] = [
      { id: "first_a", splitSlotId: "slotA", startedAt: t0 },
    ];

    expect(previousSessionExerciseOrder(sessions, [], "first_a")).toEqual([]);
  });
});
