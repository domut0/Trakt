import { describe, expect, it } from "vitest";
import {
  computePrefill,
  matchSlot,
  predictNextSlotName,
  suggestNextExercise,
  type SplitSlot,
  type WorkoutSession,
  type WorkoutSet,
} from "../store";

describe("predictNextSlotName (rotation round-robin)", () => {
  it("returns undefined for an empty rotation", () => {
    expect(predictNextSlotName([])).toBeUndefined();
  });

  it("returns the first slot (by rotationOrder) when none have been logged yet", () => {
    const slots: SplitSlot[] = [
      { id: "b", name: "Squat", rotationOrder: 1 },
      { id: "a", name: "Heavy Bench", rotationOrder: 0 },
    ];
    expect(predictNextSlotName(slots)).toBe("Heavy Bench");
  });

  it("predicts the slot after the most-recently-logged one", () => {
    const slots: SplitSlot[] = [
      { id: "a", name: "Heavy Bench", rotationOrder: 0, lastLoggedAt: 3000 },
      { id: "b", name: "Squat", rotationOrder: 1, lastLoggedAt: 1000 },
      { id: "c", name: "Volume Bench", rotationOrder: 2, lastLoggedAt: 2000 },
    ];
    // Most recently logged is "Heavy Bench" (3000, the largest timestamp) at
    // rotationOrder 0 -> next is rotationOrder 1, "Squat".
    expect(predictNextSlotName(slots)).toBe("Squat");
  });

  it("wraps around from the last slot in rotation order back to the first", () => {
    const slots: SplitSlot[] = [
      { id: "a", name: "Heavy Bench", rotationOrder: 0, lastLoggedAt: 1000 },
      { id: "b", name: "Squat", rotationOrder: 1, lastLoggedAt: 2000 },
      { id: "c", name: "Volume Bench", rotationOrder: 2, lastLoggedAt: 3000 },
    ];
    // Most recently logged is "Volume Bench" (3000) at the end of the
    // rotation -> wraps back to rotationOrder 0, "Heavy Bench".
    expect(predictNextSlotName(slots)).toBe("Heavy Bench");
  });
});

describe("matchSlot (case-insensitive, whitespace-trimmed lookup)", () => {
  const slots: SplitSlot[] = [
    { id: "s_hb", name: "Heavy Bench", rotationOrder: 0 },
    { id: "s_arms", name: "Arms", rotationOrder: 1 },
  ];

  it("matches an exact name", () => {
    expect(matchSlot(slots, "Heavy Bench")?.id).toBe("s_hb");
  });

  it("matches regardless of case", () => {
    expect(matchSlot(slots, "heavy bench")?.id).toBe("s_hb");
    expect(matchSlot(slots, "HEAVY BENCH")?.id).toBe("s_hb");
  });

  it("matches with surrounding whitespace trimmed", () => {
    expect(matchSlot(slots, "  Heavy Bench  ")?.id).toBe("s_hb");
  });

  it("does not match a genuinely new name", () => {
    expect(matchSlot(slots, "Leg Day")).toBeUndefined();
  });
});

describe("suggestNextExercise (per-slot scoped suggestion)", () => {
  const t0 = 1_000_000;

  const sessions: WorkoutSession[] = [
    { id: "past_a", splitSlotId: "slotA", startedAt: t0, endedAt: t0 + 5000 },
    { id: "today_a", splitSlotId: "slotA", startedAt: t0 + 10_000 },
    { id: "past_b", splitSlotId: "slotB", startedAt: t0, endedAt: t0 + 5000 },
    { id: "today_b", splitSlotId: "slotB", startedAt: t0 + 10_000 },
    { id: "slotC_today", splitSlotId: "slotC", startedAt: t0 + 10_000 },
  ];

  const sets: WorkoutSet[] = [
    // slotA's last occurrence: ex1, ex2, ex3 in logged order.
    { id: "s1", sessionId: "past_a", exerciseId: "ex1", weight: 100, reps: 5, loggedAt: t0 + 10 },
    { id: "s2", sessionId: "past_a", exerciseId: "ex2", weight: 50, reps: 8, loggedAt: t0 + 20 },
    { id: "s3", sessionId: "past_a", exerciseId: "ex3", weight: 30, reps: 10, loggedAt: t0 + 30 },
    // slotB's last occurrence: a totally different exercise history.
    { id: "s4", sessionId: "past_b", exerciseId: "exX", weight: 200, reps: 3, loggedAt: t0 + 10 },
    { id: "s5", sessionId: "past_b", exerciseId: "exY", weight: 60, reps: 12, loggedAt: t0 + 20 },
    // today_a: ex1 already logged.
    {
      id: "s6",
      sessionId: "today_a",
      exerciseId: "ex1",
      weight: 105,
      reps: 5,
      loggedAt: t0 + 10_010,
    },
  ];

  it("suggests the next exercise in logged order, skipping what's already done today", () => {
    const sug = suggestNextExercise(sessions, sets, "today_a");
    expect(sug?.exerciseId).toBe("ex2");
    expect(sug?.weight).toBe(50);
    expect(sug?.reps).toBe(8);
  });

  it("does not cross-contaminate with a different split slot's history", () => {
    // today_b has logged nothing yet; its slot's last occurrence (past_b) used
    // exX/exY, never ex1/ex2/ex3 from slotA.
    const sug = suggestNextExercise(sessions, sets, "today_b");
    expect(sug?.exerciseId).toBe("exX");
    expect(sug?.weight).toBe(200);
  });

  it("advances one exercise at a time as more are logged", () => {
    const setsWithTwoDone: WorkoutSet[] = [
      ...sets,
      {
        id: "s7",
        sessionId: "today_a",
        exerciseId: "ex2",
        weight: 50,
        reps: 8,
        loggedAt: t0 + 10_020,
      },
    ];
    const sug = suggestNextExercise(sessions, setsWithTwoDone, "today_a");
    expect(sug?.exerciseId).toBe("ex3");
  });

  it("returns undefined once every exercise from last time has been done", () => {
    const setsAllDone: WorkoutSet[] = [
      ...sets,
      {
        id: "s7",
        sessionId: "today_a",
        exerciseId: "ex2",
        weight: 50,
        reps: 8,
        loggedAt: t0 + 10_020,
      },
      {
        id: "s8",
        sessionId: "today_a",
        exerciseId: "ex3",
        weight: 30,
        reps: 10,
        loggedAt: t0 + 10_030,
      },
    ];
    expect(suggestNextExercise(sessions, setsAllDone, "today_a")).toBeUndefined();
  });

  it("returns undefined when the slot has no prior completed occurrence", () => {
    expect(suggestNextExercise(sessions, sets, "slotC_today")).toBeUndefined();
  });

  it("returns undefined for an unknown session id", () => {
    expect(suggestNextExercise(sessions, sets, "does-not-exist")).toBeUndefined();
  });
});

describe("computePrefill (distinct-weight-block matching)", () => {
  const t0 = 1_000_000;

  it("prefills the first distinct block today from the first distinct block last time", () => {
    const sessions: WorkoutSession[] = [
      { id: "prev", splitSlotId: "slotH", startedAt: t0, endedAt: t0 + 5000 },
      { id: "today", splitSlotId: "slotH", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      // prev: block 1 = top single, block 2 = backdown triples (distinct weight/rep).
      { id: "p1", sessionId: "prev", exerciseId: "bench", weight: 225, reps: 1, loggedAt: t0 + 10 },
      { id: "p2", sessionId: "prev", exerciseId: "bench", weight: 190, reps: 3, loggedAt: t0 + 20 },
      { id: "p3", sessionId: "prev", exerciseId: "bench", weight: 190, reps: 3, loggedAt: t0 + 30 },
      { id: "p4", sessionId: "prev", exerciseId: "bench", weight: 190, reps: 3, loggedAt: t0 + 40 },
    ];

    // Nothing logged today yet -> distinctToday = 0 -> first distinct block from last time.
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 1,
      rpe: undefined,
    });
  });

  it("prefills the second distinct block from the second distinct block last time", () => {
    const sessions: WorkoutSession[] = [
      { id: "prev", splitSlotId: "slotH", startedAt: t0, endedAt: t0 + 5000 },
      { id: "today", splitSlotId: "slotH", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "p1", sessionId: "prev", exerciseId: "bench", weight: 225, reps: 1, loggedAt: t0 + 10 },
      { id: "p2", sessionId: "prev", exerciseId: "bench", weight: 190, reps: 3, loggedAt: t0 + 20 },
      { id: "p3", sessionId: "prev", exerciseId: "bench", weight: 190, reps: 3, loggedAt: t0 + 30 },
      // Today already logged the first (single) block -> distinctToday = 1.
      {
        id: "t1",
        sessionId: "today",
        exerciseId: "bench",
        weight: 225,
        reps: 1,
        loggedAt: t0 + 10_010,
      },
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 190,
      reps: 3,
      rpe: undefined,
    });
  });

  it("returns {} when there is no prior completed session for this slot", () => {
    const sessions: WorkoutSession[] = [{ id: "today", splitSlotId: "slotH", startedAt: t0 }];
    expect(computePrefill(sessions, [], "today", "bench")).toEqual({});
  });

  it("returns {} when today has already exhausted the distinct blocks seen last time", () => {
    const sessions: WorkoutSession[] = [
      { id: "prev", splitSlotId: "slotH", startedAt: t0, endedAt: t0 + 5000 },
      { id: "today", splitSlotId: "slotH", startedAt: t0 + 10_000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "p1", sessionId: "prev", exerciseId: "bench", weight: 225, reps: 1, loggedAt: t0 + 10 },
      {
        id: "t1",
        sessionId: "today",
        exerciseId: "bench",
        weight: 225,
        reps: 1,
        loggedAt: t0 + 10_010,
      },
    ];
    // Only one distinct block existed last time; today has already matched it once (distinctToday = 1).
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({});
  });

  it("self-correcting block transition: a manual correction becomes the new prefill source next time (PRD 7.5)", () => {
    const sessions: WorkoutSession[] = [
      // Oldest: original scheme (top single + backdown triples).
      { id: "sessA", splitSlotId: "slotH", startedAt: 1000, endedAt: 1100 },
      // Middle: the day the lifter changed programs and manually corrected the
      // prefill (doubles + backdown 4s) instead of accepting the old suggestion.
      { id: "sessB", splitSlotId: "slotH", startedAt: 2000, endedAt: 2100 },
      // Current: should now prefill from the CORRECTED sessB, not the older sessA.
      { id: "sessC", splitSlotId: "slotH", startedAt: 3000 },
    ];
    const sets: WorkoutSet[] = [
      { id: "a1", sessionId: "sessA", exerciseId: "bench", weight: 225, reps: 1, loggedAt: 1010 },
      { id: "a2", sessionId: "sessA", exerciseId: "bench", weight: 190, reps: 3, loggedAt: 1020 },
      { id: "a3", sessionId: "sessA", exerciseId: "bench", weight: 190, reps: 3, loggedAt: 1030 },
      { id: "a4", sessionId: "sessA", exerciseId: "bench", weight: 190, reps: 3, loggedAt: 1040 },
      // sessB: the lifter typed over the prefill with the new scheme.
      { id: "b1", sessionId: "sessB", exerciseId: "bench", weight: 225, reps: 2, loggedAt: 2010 },
      { id: "b2", sessionId: "sessB", exerciseId: "bench", weight: 190, reps: 4, loggedAt: 2020 },
      { id: "b3", sessionId: "sessB", exerciseId: "bench", weight: 190, reps: 4, loggedAt: 2030 },
      { id: "b4", sessionId: "sessB", exerciseId: "bench", weight: 190, reps: 4, loggedAt: 2040 },
    ];

    // First block today should prefill from sessB's corrected top-set (225x2), not sessA's (225x1).
    expect(computePrefill(sessions, sets, "sessC", "bench")).toEqual({
      weight: 225,
      reps: 2,
      rpe: undefined,
    });

    // Once today's first block is logged matching the corrected scheme, the
    // second block should prefill from sessB's corrected backdowns (190x4).
    const setsAfterFirstBlockToday: WorkoutSet[] = [
      ...sets,
      { id: "c1", sessionId: "sessC", exerciseId: "bench", weight: 225, reps: 2, loggedAt: 3010 },
    ];
    expect(computePrefill(sessions, setsAfterFirstBlockToday, "sessC", "bench")).toEqual({
      weight: 190,
      reps: 4,
      rpe: undefined,
    });
  });
});
