import { describe, expect, it } from "vitest";
import { estimate1RM } from "../onerm";
import type { Exercise, WorkoutSession, WorkoutSet } from "../store";
import {
  buildWorkoutSummary,
  formatDuration,
  formatNumber,
  recordDetail,
  recordTitle,
  recordValue,
  type SummaryRecord,
  type WorkoutSummaryInput,
} from "../workout-summary";

/**
 * The post-workout summary's builder. Every case here is the screen that ends
 * an hour of work, so the two things under test throughout are that the facts
 * are right and that bad data costs a row rather than the screen.
 */

const TODAY_ID = "session-today";
const OLD_ID = "session-old";
const START = 1_700_000_000_000;
const MINUTE = 60_000;

let nextId = 0;

/** A set with sane defaults. `loggedAt` climbs per call, so creation order is chronological. */
function mkSet(overrides: Partial<WorkoutSet> & Pick<WorkoutSet, "weight" | "reps">): WorkoutSet {
  nextId += 1;
  return {
    id: `set-${nextId}`,
    sessionId: TODAY_ID,
    exerciseId: "bench",
    loggedAt: START + nextId * MINUTE,
    ...overrides,
  };
}

/** A set belonging to an earlier session, i.e. history to be beaten. */
function oldSet(overrides: Partial<WorkoutSet> & Pick<WorkoutSet, "weight" | "reps">): WorkoutSet {
  return mkSet({ sessionId: OLD_ID, loggedAt: START - 7 * 86_400_000, ...overrides });
}

function mkSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return { id: TODAY_ID, splitSlotId: "push", startedAt: START, ...overrides };
}

const EXERCISES: Exercise[] = [
  { id: "bench", name: "Bench Press", type: "main" },
  { id: "squat", name: "Back Squat", type: "main" },
  { id: "curl", name: "Incline DB Curl", type: "accessory" },
];

/**
 * Assembles a builder input. Defaults describe the ordinary case: one strength
 * session today, one a week ago, both listed in `sessions` so the cardio guard
 * in `setsForExercise` can find them.
 */
function input(overrides: Partial<WorkoutSummaryInput> = {}): WorkoutSummaryInput {
  // Spread copies an explicitly-undefined override, which is what lets a test
  // ask for "no session at all" without a second escape hatch.
  return {
    session: mkSession(),
    slotName: "Heavy Bench",
    sets: [],
    sessions: [mkSession(), { id: OLD_ID, splitSlotId: "push", startedAt: START - 604_800_000 }],
    exercises: EXERCISES,
    unit: "lbs",
    endedAt: START + 62 * MINUTE,
    ...overrides,
  };
}

function e1rm(weight: number, reps: number): number {
  return estimate1RM(weight, reps).average;
}

function kinds(records: readonly SummaryRecord[]): string[] {
  return records.map((r) => r.kind);
}

describe("buildWorkoutSummary: when there is nothing honest to show", () => {
  it("returns null for no session at all", () => {
    expect(buildWorkoutSummary(input({ session: undefined }))).toBeNull();
  });

  it("returns null for a session whose id is unusable", () => {
    expect(buildWorkoutSummary(input({ session: mkSession({ id: "" }) }))).toBeNull();
  });

  it("returns null for a session with nothing logged", () => {
    // Ending an empty workout is a cancel, not an achievement.
    expect(buildWorkoutSummary(input({ sets: [] }))).toBeNull();
  });

  it("returns null when every logged set belongs to some other session", () => {
    const sets = [oldSet({ weight: 225, reps: 5 })];
    expect(buildWorkoutSummary(input({ sets }))).toBeNull();
  });

  it("returns null rather than throwing when the collections are not arrays", () => {
    const sets = [mkSet({ weight: 225, reps: 5 })];
    const broken = { session: mkSession(), sets };
    expect(
      buildWorkoutSummary(input({ ...broken, sets: undefined as unknown as WorkoutSet[] })),
    ).toBeNull();
    expect(
      buildWorkoutSummary(input({ ...broken, sessions: null as unknown as WorkoutSession[] })),
    ).toBeNull();
    expect(
      buildWorkoutSummary(input({ ...broken, exercises: undefined as unknown as Exercise[] })),
    ).toBeNull();
  });
});

describe("buildWorkoutSummary: the cardio guard", () => {
  it("returns null for a cardio session even when sets somehow hang off it", () => {
    // A cardio entry holds no sets by construction, so one that carries them is
    // corrupt data, and a treadmill run must never produce a lifting summary.
    const session = mkSession({ kind: "cardio", cardioExerciseId: "treadmill" });
    const sets = [mkSet({ weight: 225, reps: 5 })];
    expect(buildWorkoutSummary(input({ session, sets }))).toBeNull();
  });

  it("treats an absent kind as strength", () => {
    const session = mkSession({ kind: undefined });
    const sets = [mkSet({ weight: 225, reps: 5 })];
    expect(buildWorkoutSummary(input({ session, sets }))?.setCount).toBe(1);
  });

  it("cannot draw a record baseline out of a cardio session's sets", () => {
    // The history side goes through `setsForExercise`, which takes the sessions
    // list precisely so this cannot be skipped: with the only prior bench work
    // sitting inside a cardio entry, today's 245 has nothing legitimate to beat.
    const sessions = [
      mkSession(),
      { id: OLD_ID, startedAt: START - 604_800_000, kind: "cardio" as const },
    ];
    const sets = [oldSet({ weight: 225, reps: 5 }), mkSet({ weight: 245, reps: 3 })];
    expect(buildWorkoutSummary(input({ sets, sessions }))?.records).toEqual([]);
  });
});

describe("buildWorkoutSummary: the facts", () => {
  it("counts sets and the distinct exercises they belong to", () => {
    const sets = [
      mkSet({ weight: 225, reps: 5 }),
      mkSet({ weight: 225, reps: 5 }),
      mkSet({ exerciseId: "squat", weight: 315, reps: 3 }),
    ];
    const summary = buildWorkoutSummary(input({ sets }));
    expect(summary?.setCount).toBe(3);
    expect(summary?.exerciseCount).toBe(2);
  });

  it("counts only this session's sets", () => {
    const sets = [
      mkSet({ weight: 225, reps: 5 }),
      oldSet({ weight: 135, reps: 10 }),
      oldSet({ exerciseId: "squat", weight: 315, reps: 3 }),
    ];
    const summary = buildWorkoutSummary(input({ sets }));
    expect(summary?.setCount).toBe(1);
    expect(summary?.exerciseCount).toBe(1);
  });

  it("carries the slot name, the session id and the unit through untouched", () => {
    const sets = [mkSet({ weight: 100, reps: 5 })];
    const summary = buildWorkoutSummary(input({ sets, unit: "kg", slotName: "Squat" }));
    expect(summary?.sessionId).toBe(TODAY_ID);
    expect(summary?.slotName).toBe("Squat");
    expect(summary?.unit).toBe("kg");
  });

  it("measures duration from the session start to the instant End was pressed", () => {
    const sets = [mkSet({ weight: 225, reps: 5 })];
    const summary = buildWorkoutSummary(input({ sets, endedAt: START + 74 * MINUTE }));
    expect(summary?.durationMinutes).toBe(74);
  });

  it("rounds duration to the nearest minute", () => {
    const sets = [mkSet({ weight: 225, reps: 5 })];
    const at = (ms: number) => buildWorkoutSummary(input({ sets, endedAt: START + ms }));
    expect(at(29_000)?.durationMinutes).toBe(0);
    expect(at(31_000)?.durationMinutes).toBe(1);
    expect(at(90_000)?.durationMinutes).toBe(2);
  });

  it("never reports a negative duration when the clock disagrees with itself", () => {
    const sets = [mkSet({ weight: 225, reps: 5 })];
    expect(buildWorkoutSummary(input({ sets, endedAt: START - MINUTE }))?.durationMinutes).toBe(0);
  });

  it("falls back to zero minutes rather than NaN on an unusable timestamp", () => {
    const sets = [mkSet({ weight: 225, reps: 5 })];
    const noStart = mkSession({ startedAt: Number.NaN });
    expect(buildWorkoutSummary(input({ sets, session: noStart }))?.durationMinutes).toBe(0);
    expect(
      buildWorkoutSummary(input({ sets, endedAt: undefined as unknown as number }))
        ?.durationMinutes,
    ).toBe(0);
  });

  it("totals the weight moved across every set", () => {
    const sets = [
      mkSet({ weight: 225, reps: 5 }),
      mkSet({ weight: 185, reps: 8 }),
      mkSet({ exerciseId: "squat", weight: 315, reps: 3 }),
    ];
    expect(buildWorkoutSummary(input({ sets }))?.volume).toBe(1125 + 1480 + 945);
  });

  it("rounds volume to a whole number", () => {
    const sets = [mkSet({ weight: 62.5, reps: 7 })];
    expect(buildWorkoutSummary(input({ sets, unit: "kg" }))?.volume).toBe(438);
  });
});

describe("buildWorkoutSummary: volume degrades rather than lies", () => {
  it("reports no volume at all when a weight is NaN", () => {
    // An imported set can carry NaN: `isWorkoutSet` only checks `typeof number`.
    // Omitting the row is honest; printing 0 for a session of real work is not.
    const sets = [mkSet({ weight: Number.NaN, reps: 5 }), mkSet({ weight: 225, reps: 5 })];
    const summary = buildWorkoutSummary(input({ sets }));
    expect(summary).not.toBeNull();
    expect(summary?.volume).toBeNull();
    expect(summary?.setCount).toBe(2);
  });

  it("reports no volume when a weight is Infinity", () => {
    const sets = [mkSet({ weight: Number.POSITIVE_INFINITY, reps: 5 })];
    expect(buildWorkoutSummary(input({ sets }))?.volume).toBeNull();
  });

  it("reports no volume when a weight is missing entirely", () => {
    const sets = [mkSet({ weight: undefined as unknown as number, reps: 5 })];
    const summary = buildWorkoutSummary(input({ sets }));
    expect(summary).not.toBeNull();
    expect(summary?.volume).toBeNull();
  });

  it("reports no volume for a session of bodyweight sets rather than a zero", () => {
    const sets = [mkSet({ exerciseId: "curl", weight: 0, reps: 12 })];
    expect(buildWorkoutSummary(input({ sets }))?.volume).toBeNull();
  });

  it("still reports the rest of the session when the volume is unusable", () => {
    const sets = [mkSet({ weight: Number.NaN, reps: 5 })];
    const summary = buildWorkoutSummary(input({ sets, endedAt: START + 40 * MINUTE }));
    expect(summary?.setCount).toBe(1);
    expect(summary?.exerciseCount).toBe(1);
    expect(summary?.durationMinutes).toBe(40);
  });
});

describe("buildWorkoutSummary: records", () => {
  it("reports nothing when the session beat nothing", () => {
    const sets = [oldSet({ weight: 225, reps: 5 }), mkSet({ weight: 205, reps: 5 })];
    expect(buildWorkoutSummary(input({ sets }))?.records).toEqual([]);
  });

  it("reports nothing for an exercise with no history to beat", () => {
    // The first ever session of an exercise establishes the baseline; calling
    // that a run of records is hollow praise.
    const sets = [mkSet({ weight: 225, reps: 5 })];
    expect(buildWorkoutSummary(input({ sets }))?.records).toEqual([]);
  });

  it("reports a weight record with the number it beat", () => {
    const sets = [oldSet({ weight: 225, reps: 5 }), mkSet({ weight: 245, reps: 3 })];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "weight",
      exerciseId: "bench",
      exerciseName: "Bench Press",
      value: 245,
      previous: 225,
    });
  });

  it("reports an estimated 1RM record when the load was matched but not beaten", () => {
    const sets = [oldSet({ weight: 225, reps: 5 }), mkSet({ weight: 225, reps: 8 })];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("e1rm");
    expect(records[0].value).toBe(e1rm(225, 8));
    expect(records[0].previous).toBe(e1rm(225, 5));
  });

  it("reports a rep record with the load it was set at", () => {
    // 15 reps is past RELIABLE_REP_LIMIT, so the e1RM axis is closed and the
    // rep axis is the only one this set can win.
    const sets = [oldSet({ weight: 135, reps: 13 }), mkSet({ weight: 135, reps: 15 })];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: "reps", value: 15, previous: 13, atWeight: 135 });
  });

  it("carries no atWeight on the weight and 1RM axes", () => {
    const sets = [oldSet({ weight: 225, reps: 5 }), mkSet({ weight: 245, reps: 3 })];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records[0].atWeight).toBeUndefined();
    expect("atWeight" in records[0]).toBe(false);
  });

  it("keeps one record per exercise even when a set wins several axes at once", () => {
    // 225x8 beats the old 225x5 on both estimated 1RM and reps. Reporting two
    // records for one set is the noise pr.ts exists to avoid.
    const sets = [oldSet({ weight: 225, reps: 5 }), mkSet({ weight: 225, reps: 8 })];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("e1rm");
  });

  it("reports one record for each exercise that set one", () => {
    const sets = [
      oldSet({ weight: 225, reps: 5 }),
      oldSet({ exerciseId: "squat", weight: 315, reps: 3 }),
      oldSet({ exerciseId: "curl", weight: 35, reps: 13 }),
      mkSet({ weight: 245, reps: 3 }),
      mkSet({ exerciseId: "squat", weight: 315, reps: 6 }),
      mkSet({ exerciseId: "curl", weight: 35, reps: 15 }),
    ];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.exerciseId).sort()).toEqual(["bench", "curl", "squat"]);
    expect(kinds(records)).toEqual(["weight", "e1rm", "reps"]);
  });

  it("leads with the most significant record", () => {
    // The squat's rep record is logged first; the bench's weight record leads.
    const sets = [
      oldSet({ exerciseId: "squat", weight: 315, reps: 13 }),
      oldSet({ weight: 225, reps: 5 }),
      mkSet({ exerciseId: "squat", weight: 315, reps: 15 }),
      mkSet({ weight: 245, reps: 3 }),
    ];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records[0]).toMatchObject({ kind: "weight", exerciseName: "Bench Press" });
    expect(records[1]).toMatchObject({ kind: "reps", exerciseName: "Back Squat" });
  });

  it("orders every record by significance, not just the first", () => {
    // The interface promises "most significant first" for the whole list, and
    // the rows after the headline are read as a list. Logged here in the
    // reverse of significance order: curl reps, squat 1RM, bench weight.
    const sets = [
      oldSet({ exerciseId: "curl", weight: 35, reps: 13 }),
      oldSet({ exerciseId: "squat", weight: 315, reps: 5 }),
      oldSet({ weight: 225, reps: 5 }),
      mkSet({ exerciseId: "curl", weight: 35, reps: 15, loggedAt: START + MINUTE }),
      mkSet({ exerciseId: "squat", weight: 315, reps: 8, loggedAt: START + 2 * MINUTE }),
      mkSet({ weight: 245, reps: 3, loggedAt: START + 3 * MINUTE }),
    ];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(kinds(records)).toEqual(["weight", "e1rm", "reps"]);
  });

  it("keeps the session's own order between records of equal significance", () => {
    const sets = [
      oldSet({ exerciseId: "squat", weight: 315, reps: 5 }),
      oldSet({ weight: 225, reps: 5 }),
      mkSet({ exerciseId: "squat", weight: 325, reps: 5, loggedAt: START + MINUTE }),
      mkSet({ weight: 245, reps: 3, loggedAt: START + 2 * MINUTE }),
    ];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(kinds(records)).toEqual(["weight", "weight"]);
    expect(records.map((r) => r.exerciseName)).toEqual(["Back Squat", "Bench Press"]);
  });

  it("drops a record whose exercise cannot be named", () => {
    // Better to say nothing than to announce a record for "unknown".
    const sets = [
      oldSet({ exerciseId: "ghost", weight: 225, reps: 5 }),
      mkSet({ exerciseId: "ghost", weight: 245, reps: 3 }),
    ];
    const summary = buildWorkoutSummary(input({ sets }));
    expect(summary?.setCount).toBe(1);
    expect(summary?.records).toEqual([]);
  });

  it("does not credit a warm-up on the way up to a top set", () => {
    // Nobody warms up after their top set, so the 135 is not a rep record even
    // though it is the most reps ever done at 135 or above.
    const sets = [
      oldSet({ weight: 225, reps: 5 }),
      mkSet({ weight: 135, reps: 12, loggedAt: START + MINUTE }),
      mkSet({ weight: 225, reps: 5, loggedAt: START + 5 * MINUTE }),
    ];
    expect(buildWorkoutSummary(input({ sets }))?.records).toEqual([]);
  });

  it("measures previous from before the session, not from earlier in it", () => {
    // "Up from 225" is the story. "Up from the 235 you did forty minutes ago"
    // is technically true and useless.
    const sets = [
      oldSet({ weight: 225, reps: 3 }),
      mkSet({ weight: 235, reps: 3, loggedAt: START + MINUTE }),
      mkSet({ weight: 245, reps: 3, loggedAt: START + 5 * MINUTE }),
    ];
    const records = buildWorkoutSummary(input({ sets }))?.records ?? [];
    expect(records[0]).toMatchObject({ kind: "weight", value: 245, previous: 225 });
  });

  it("survives a corrupt set in the history without losing the summary", () => {
    const sets = [
      oldSet({ weight: Number.NaN, reps: Number.NaN }),
      oldSet({ weight: 225, reps: 5 }),
      mkSet({ weight: 245, reps: 3 }),
    ];
    const summary = buildWorkoutSummary(input({ sets }));
    expect(summary?.records).toHaveLength(1);
    expect(summary?.records[0].value).toBe(245);
  });
});

describe("formatNumber", () => {
  it("groups thousands", () => {
    expect(formatNumber(12450)).toBe("12,450");
  });

  it("keeps one decimal where a weight has one", () => {
    expect(formatNumber(262.5)).toBe("262.5");
  });

  it("does not print a decimal that is not there", () => {
    expect(formatNumber(315)).toBe("315");
  });

  it("rounds past one decimal rather than printing a formula's noise", () => {
    expect(formatNumber(340.83333333)).toBe("340.8");
  });

  it("degrades to zero rather than printing NaN", () => {
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatDuration", () => {
  it("stays in minutes under an hour", () => {
    expect(formatDuration(47)).toBe("47 min");
    expect(formatDuration(59)).toBe("59 min");
  });

  it("shows hours once there are some", () => {
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(62)).toBe("1 h 2 min");
    expect(formatDuration(135)).toBe("2 h 15 min");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("handles a session with no measurable length", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(-5)).toBe("0 min");
    expect(formatDuration(Number.NaN)).toBe("0 min");
  });
});

describe("record copy", () => {
  const weight: SummaryRecord = {
    kind: "weight",
    exerciseId: "bench",
    exerciseName: "Bench Press",
    value: 245,
    previous: 225,
  };
  const oneRm: SummaryRecord = { ...weight, kind: "e1rm", value: 262.5, previous: 255 };
  const reps: SummaryRecord = { ...weight, kind: "reps", value: 8, previous: 6, atWeight: 185 };

  it("names each axis in the lifter's terms", () => {
    expect(recordTitle(weight, "lbs")).toBe("Heaviest Bench Press");
    expect(recordTitle(oneRm, "lbs")).toBe("Best estimated 1RM, Bench Press");
    expect(recordTitle(reps, "lbs")).toBe("Most reps at 185 lbs, Bench Press");
  });

  it("names a rep record without a load when the set cannot be found", () => {
    expect(recordTitle({ ...reps, atWeight: undefined }, "lbs")).toBe("Most reps, Bench Press");
  });

  it("states what was beaten, flatly", () => {
    expect(recordDetail(weight, "lbs")).toBe("Up from 225 lbs");
    expect(recordDetail(oneRm, "kg")).toBe("Up from 255 kg");
    expect(recordDetail(reps, "lbs")).toBe("Up from 6 reps");
    expect(recordDetail({ ...reps, previous: 1 }, "lbs")).toBe("Up from 1 rep");
  });

  it("splits the value from its unit so the number can carry the row", () => {
    expect(recordValue(weight, "lbs")).toEqual({ value: "245", suffix: "lbs" });
    expect(recordValue(oneRm, "kg")).toEqual({ value: "262.5", suffix: "kg" });
    expect(recordValue(reps, "lbs")).toEqual({ value: "8", suffix: "reps" });
    expect(recordValue({ ...reps, value: 1 }, "lbs")).toEqual({ value: "1", suffix: "rep" });
  });

  it("never writes copy the design forbids", () => {
    const all = [weight, oneRm, reps];
    for (const record of all) {
      for (const text of [
        recordTitle(record, "lbs"),
        recordDetail(record, "lbs"),
        recordValue(record, "lbs").suffix,
      ]) {
        expect(text).not.toContain("!");
        expect(text).not.toContain("—");
      }
    }
  });
});
