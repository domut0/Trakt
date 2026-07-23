import { describe, expect, it } from "vitest";
import { detectSessionPRs, formatPRMessage, type DetectedPR } from "../pr-detection";
import type { Exercise, WorkoutSet } from "../store";

const DAY = 86400000;
const NOW = 2_000_000_000_000; // arbitrary fixed anchor so tests are deterministic

function set(partial: Partial<WorkoutSet> & Pick<WorkoutSet, "exerciseId" | "weight" | "reps" | "loggedAt">): WorkoutSet {
  return {
    id: `set_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "sess_current",
    ...partial,
  };
}

describe("detectSessionPRs", () => {
  it("detects a new estimated-1RM best within the month window", () => {
    const exercises: Exercise[] = [{ id: "e1", name: "Bench Press", type: "main" }];
    const prior = set({ exerciseId: "e1", weight: 200, reps: 5, loggedAt: NOW - 15 * DAY }); // e1RM 233, outside week, inside month
    const session = set({ exerciseId: "e1", weight: 200, reps: 8, loggedAt: NOW }); // e1RM 253 — beats 233

    const prs = detectSessionPRs({
      sessionSets: [session],
      allSets: [prior, session],
      exercises,
      now: NOW,
    });

    expect(prs).toEqual<DetectedPR[]>([
      { exerciseId: "e1", exerciseName: "Bench Press", kind: "e1rm", window: "month" },
    ]);
    expect(formatPRMessage(prs)).toBe("Bench Press: best estimated 1RM this month");
  });

  it("detects a new rep-at-exact-weight best, scoped to that weight (not a false e1RM PR from a heavier set)", () => {
    const exercises: Exercise[] = [{ id: "e2", name: "Overhead Press", type: "main" }];
    // A heavier prior set (at a different weight) sets a month e1RM bar the
    // session never clears, so any PR here can only come from the reps-at-
    // exact-weight comparison, not the overall e1RM comparison.
    const priorHeavy = set({ exerciseId: "e2", weight: 225, reps: 3, loggedAt: NOW - 10 * DAY }); // e1RM 248
    const priorSameWeight = set({ exerciseId: "e2", weight: 185, reps: 5, loggedAt: NOW - 10 * DAY }); // e1RM 216, 5 reps @ 185
    const session = set({ exerciseId: "e2", weight: 185, reps: 6, loggedAt: NOW }); // e1RM 222 (< 248) but 6 reps @ 185 (> 5)

    const prs = detectSessionPRs({
      sessionSets: [session],
      allSets: [priorHeavy, priorSameWeight, session],
      exercises,
      now: NOW,
    });

    expect(prs).toEqual<DetectedPR[]>([
      { exerciseId: "e2", exerciseName: "Overhead Press", kind: "reps", window: "month" },
    ]);
    expect(formatPRMessage(prs)).toBe("Overhead Press: rep best this month");
  });

  it("fires nothing when the session neither beats the e1RM nor the rep-at-weight baseline", () => {
    const exercises: Exercise[] = [{ id: "e3", name: "Back Squat", type: "main" }];
    const prior = set({ exerciseId: "e3", weight: 100, reps: 10, loggedAt: NOW - 5 * DAY }); // e1RM 133
    const session = set({ exerciseId: "e3", weight: 100, reps: 10, loggedAt: NOW }); // identical — not strictly greater

    const prs = detectSessionPRs({
      sessionSets: [session],
      allSets: [prior, session],
      exercises,
      now: NOW,
    });

    expect(prs).toEqual([]);
    expect(formatPRMessage(prs)).toBeNull();
  });

  it("fires no PR for a first-ever session with no prior baseline to beat", () => {
    const exercises: Exercise[] = [{ id: "e8", name: "Deadlift", type: "main" }];
    const session = set({ exerciseId: "e8", weight: 225, reps: 5, loggedAt: NOW });

    const prs = detectSessionPRs({
      sessionSets: [session],
      allSets: [session], // nothing else in the store for this exercise
      exercises,
      now: NOW,
    });

    expect(prs).toEqual([]);
    expect(formatPRMessage(prs)).toBeNull();
  });

  describe("week window boundary", () => {
    const exercises: Exercise[] = [{ id: "e4", name: "Incline Bench Press", type: "main" }];
    // An older, higher, unbeaten prior set blocks any "month" claim, so
    // whether a "week" PR fires depends entirely on whether the second prior
    // set (right at/near the 7-day line) lands inside or outside the week
    // window.
    const monthBlocker = set({ exerciseId: "e4", weight: 300, reps: 1, loggedAt: NOW - 10 * DAY }); // e1RM 300, never beaten below
    const session = set({ exerciseId: "e4", weight: 205, reps: 5, loggedAt: NOW }); // e1RM 239

    it("counts a prior set exactly at now - 7*DAY as inside the week window (inclusive boundary)", () => {
      const atBoundary = set({ exerciseId: "e4", weight: 200, reps: 5, loggedAt: NOW - 7 * DAY }); // e1RM 233, beaten by 239

      const prs = detectSessionPRs({
        sessionSets: [session],
        allSets: [monthBlocker, atBoundary, session],
        exercises,
        now: NOW,
      });

      expect(prs).toEqual<DetectedPR[]>([
        { exerciseId: "e4", exerciseName: "Incline Bench Press", kind: "e1rm", window: "week" },
      ]);
    });

    it("excludes a prior set at now - 7*DAY - 1 from the week window, flipping the result", () => {
      const justOutside = set({ exerciseId: "e4", weight: 200, reps: 5, loggedAt: NOW - 7 * DAY - 1 }); // same e1RM 233, but now outside the week window (still inside month)

      const prs = detectSessionPRs({
        sessionSets: [session],
        allSets: [monthBlocker, justOutside, session],
        exercises,
        now: NOW,
      });

      // The month claim is still blocked by monthBlocker (300), and there is
      // no longer any set inside the week window at all, so no PR fires —
      // proving the boundary is exclusive one millisecond earlier.
      expect(prs).toEqual([]);
    });
  });

  describe("month window boundary", () => {
    const exercises: Exercise[] = [{ id: "e6", name: "Trap Bar Deadlift", type: "main" }];
    const session = set({ exerciseId: "e6", weight: 250, reps: 5, loggedAt: NOW }); // e1RM 292

    it("counts a prior set exactly at now - 30*DAY as inside the month window (inclusive boundary)", () => {
      const atBoundary = set({ exerciseId: "e6", weight: 200, reps: 5, loggedAt: NOW - 30 * DAY }); // e1RM 233

      const prs = detectSessionPRs({
        sessionSets: [session],
        allSets: [atBoundary, session],
        exercises,
        now: NOW,
      });

      expect(prs).toEqual<DetectedPR[]>([
        { exerciseId: "e6", exerciseName: "Trap Bar Deadlift", kind: "e1rm", window: "month" },
      ]);
    });

    it("does not count a prior set just outside 30 days at all", () => {
      const justOutside = set({ exerciseId: "e6", weight: 200, reps: 5, loggedAt: NOW - 30 * DAY - 1 });

      const prs = detectSessionPRs({
        sessionSets: [session],
        allSets: [justOutside, session],
        exercises,
        now: NOW,
      });

      expect(prs).toEqual([]);
    });
  });
});

describe("formatPRMessage", () => {
  it("returns null for an empty list", () => {
    expect(formatPRMessage([])).toBeNull();
  });

  it("formats a reps PR distinctly from an e1RM PR", () => {
    const prs: DetectedPR[] = [
      { exerciseId: "e_push", exerciseName: "Tricep Pushdown", kind: "reps", window: "week" },
    ];
    expect(formatPRMessage(prs)).toBe("Tricep Pushdown: rep best this week");
  });

  it("prefers the strongest claim (month over week, e1RM over reps) when several are present", () => {
    const prs: DetectedPR[] = [
      { exerciseId: "e_a", exerciseName: "Exercise A", kind: "reps", window: "week" },
      { exerciseId: "e_b", exerciseName: "Exercise B", kind: "e1rm", window: "month" },
      { exerciseId: "e_c", exerciseName: "Exercise C", kind: "reps", window: "month" },
    ];
    expect(formatPRMessage(prs)).toBe("Exercise B: best estimated 1RM this month");
  });
});
