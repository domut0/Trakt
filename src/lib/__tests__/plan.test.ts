import { describe, expect, it } from "vitest";
import {
  emptyPlannedWeek,
  isEmptyPlan,
  plannedWorkoutFor,
  prunePlannedWorkout,
  type PlannedWeek,
  type PlannedWorkout,
} from "../plan";

/**
 * 2026-08-10 is a Monday and 2026-08-16 the Sunday that closes the same week,
 * so this is one full Monday-to-Sunday week with no month boundary in it. The
 * same fixture week targets.test.ts uses, on purpose: both modules index the
 * same Monday-first array, and pinning them to one real calendar week means a
 * rotation bug cannot show up in one file and hide in the other.
 */
const MON_TO_SUN = [
  { key: "2026-08-10", label: "Mon" },
  { key: "2026-08-11", label: "Tue" },
  { key: "2026-08-12", label: "Wed" },
  { key: "2026-08-13", label: "Thu" },
  { key: "2026-08-14", label: "Fri" },
  { key: "2026-08-15", label: "Sat" },
  { key: "2026-08-16", label: "Sun" },
] as const;

/** A week where every day is planned and no two days are alike, so a lookup
 * landing one slot off is always visible rather than sometimes right. */
function distinctWeek(): PlannedWeek {
  return MON_TO_SUN.map((d, i) => ({ name: d.label, exerciseIds: [`e${i}`] }));
}

describe("plannedWorkoutFor (weekday resolution)", () => {
  it.each(MON_TO_SUN)("resolves $key to the $label plan", ({ key, label }) => {
    expect(plannedWorkoutFor(key, distinctWeek())?.name).toBe(label);
  });

  it("reads the whole week in Monday-first order, not date-fns' Sunday-first one", () => {
    // The trap this guards: indexing a Monday-first array with a raw getDay() is
    // CORRECT on Monday and wrong the other six days, so a Monday-only check
    // passes a broken implementation. Assert all seven in one shot.
    const week = distinctWeek();
    expect(MON_TO_SUN.map((d) => plannedWorkoutFor(d.key, week)?.name)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    // What a getDay()-indexed implementation would have returned instead. If the
    // two ever agree, the Monday-first rotation has been dropped.
    const sundayFirst = MON_TO_SUN.map((d) => week[new Date(`${d.key}T00:00:00`).getDay()]?.name);
    expect(sundayFirst).toEqual(["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"]);
  });

  it("keeps Sunday and Monday apart across the week boundary", () => {
    // 2026-08-09 is the Sunday BEFORE this week and 2026-08-10 the Monday that
    // starts it: consecutive dates that must land on opposite ends of the array.
    const week = distinctWeek();
    expect(plannedWorkoutFor("2026-08-09", week)?.name).toBe("Sun");
    expect(plannedWorkoutFor("2026-08-10", week)?.name).toBe("Mon");
  });

  it("accepts a Date as well as a day key", () => {
    // Local midnight, matching how parseDayKey builds its Date.
    expect(plannedWorkoutFor(new Date("2026-08-16T00:00:00"), distinctWeek())?.name).toBe("Sun");
  });

  it("returns the planned lifts, not just the name", () => {
    const week: PlannedWeek = emptyPlannedWeek();
    week[2] = { name: "Squat day", exerciseIds: ["e_squat", "e_bench"] };
    expect(plannedWorkoutFor("2026-08-12", week)).toEqual({
      name: "Squat day",
      exerciseIds: ["e_squat", "e_bench"],
    });
  });

  it("resolves a rest day to no plan", () => {
    const week = distinctWeek();
    week[3] = null; // Thursday off
    expect(plannedWorkoutFor("2026-08-13", week)).toBeUndefined();
    // The days either side are untouched: a rest day is one null, not a gap.
    expect(plannedWorkoutFor("2026-08-12", week)?.name).toBe("Wed");
    expect(plannedWorkoutFor("2026-08-14", week)?.name).toBe("Fri");
  });

  it("resolves an absent week to no plan", () => {
    expect(plannedWorkoutFor("2026-08-10", undefined)).toBeUndefined();
  });

  it("resolves a wrong-length week to no plan rather than indexing into it", () => {
    // A truncated array is what a hand-edited backup produces. Indexed anyway it
    // would hand back a real, confidently wrong day for the days it does cover,
    // which is worse than showing nothing.
    const short = distinctWeek().slice(0, 5);
    for (const d of MON_TO_SUN) {
      expect(plannedWorkoutFor(d.key, short)).toBeUndefined();
    }
    expect(plannedWorkoutFor("2026-08-10", [...distinctWeek(), null])).toBeUndefined();
    expect(plannedWorkoutFor("2026-08-10", [])).toBeUndefined();
  });

  it.each([
    ["a number where a workout should be", 42],
    ["a string where a workout should be", "Squat day"],
    ["a workout with no name", { exerciseIds: ["e1"] }],
    ["a workout whose name is not a string", { name: 7, exerciseIds: ["e1"] }],
    ["a workout with no exerciseIds", { name: "Squat day" }],
    ["exerciseIds that are not an array", { name: "Squat day", exerciseIds: "e1" }],
    ["exerciseIds holding a non-string", { name: "Squat day", exerciseIds: ["e1", 2] }],
  ])("degrades to no plan for %s", (_label, entry) => {
    // Every one of these is reachable: the week round-trips through
    // user-editable backup JSON, where the type annotation guarantees nothing.
    const week = emptyPlannedWeek();
    week[0] = entry as unknown as PlannedWorkout;
    expect(plannedWorkoutFor("2026-08-10", week)).toBeUndefined();
  });

  it("degrades to no plan for an unparseable day key instead of throwing", () => {
    // Not hypothetical: a day key is built from user data in places, and a
    // throw here would take out the whole screen.
    expect(() => plannedWorkoutFor("not-a-date", distinctWeek())).not.toThrow();
    expect(plannedWorkoutFor("not-a-date", distinctWeek())).toBeUndefined();
  });

  it("hands back a copy, so a caller cannot mutate the stored week", () => {
    const week = distinctWeek();
    const resolved = plannedWorkoutFor("2026-08-10", week);
    resolved?.exerciseIds.push("e_sneaked_in");
    expect(plannedWorkoutFor("2026-08-10", week)?.exerciseIds).toEqual(["e0"]);
  });

  it("drops keys a hand-edited file added rather than passing them through", () => {
    const week = emptyPlannedWeek();
    week[0] = { name: "Squat day", exerciseIds: ["e1"], notes: "go heavy" } as PlannedWorkout & {
      notes: string;
    };
    expect(plannedWorkoutFor("2026-08-10", week)).toEqual({
      name: "Squat day",
      exerciseIds: ["e1"],
    });
  });
});

describe("emptyPlannedWeek", () => {
  it("is seven rest days", () => {
    expect(emptyPlannedWeek()).toEqual([null, null, null, null, null, null, null]);
  });

  it("returns a fresh array each call", () => {
    // It goes straight into store state, so a shared literal would be one
    // careless write away from mutating every other caller's week.
    const a = emptyPlannedWeek();
    a[0] = { name: "Squat day", exerciseIds: ["e1"] };
    expect(emptyPlannedWeek()[0]).toBeNull();
  });
});

describe("isEmptyPlan", () => {
  it("is true for an absent week", () => {
    expect(isEmptyPlan(undefined)).toBe(true);
  });

  it("is true for a week of rest days", () => {
    expect(isEmptyPlan(emptyPlannedWeek())).toBe(true);
  });

  it("is true for a wrong-length week", () => {
    expect(isEmptyPlan(distinctWeek().slice(0, 3))).toBe(true);
    expect(isEmptyPlan([])).toBe(true);
  });

  it("is true for a named day that plans no lifts", () => {
    // The asymmetry with plannedWorkoutFor is deliberate: a half-filled day is
    // worth keeping on screen while it is being edited, but it is not a reason
    // to put the planning surface in front of someone who never used it.
    const week = emptyPlannedWeek();
    week[1] = { name: "Tuesday", exerciseIds: [] };
    expect(isEmptyPlan(week)).toBe(true);
    expect(plannedWorkoutFor("2026-08-11", week)).toEqual({ name: "Tuesday", exerciseIds: [] });
  });

  it("is false as soon as one day plans one lift", () => {
    const week = emptyPlannedWeek();
    week[6] = { name: "Sunday", exerciseIds: ["e_squat"] };
    expect(isEmptyPlan(week)).toBe(false);
  });

  it("ignores malformed days when deciding emptiness", () => {
    const week = emptyPlannedWeek();
    week[0] = { name: "Broken", exerciseIds: "e1" } as unknown as PlannedWorkout;
    expect(isEmptyPlan(week)).toBe(true);
  });
});

describe("prunePlannedWorkout (deleted exercises)", () => {
  const planned: PlannedWorkout = { name: "Heavy Bench", exerciseIds: ["e_bench", "e_row"] };

  it("passes a fully known plan through unchanged", () => {
    expect(prunePlannedWorkout(planned, ["e_row", "e_bench", "e_squat"])).toEqual(planned);
  });

  it("drops an id that no longer names an exercise and keeps the rest", () => {
    // Deleting one lift should still preload the others. Throwing the whole day
    // away would punish the user for tidying their exercise list.
    expect(prunePlannedWorkout(planned, ["e_bench"])).toEqual({
      name: "Heavy Bench",
      exerciseIds: ["e_bench"],
    });
  });

  it("degrades to no plan when every planned lift is gone", () => {
    expect(prunePlannedWorkout(planned, ["e_squat"])).toBeUndefined();
    expect(prunePlannedWorkout(planned, [])).toBeUndefined();
  });

  it("passes no plan through as no plan", () => {
    expect(prunePlannedWorkout(undefined, ["e_bench"])).toBeUndefined();
  });

  it("keeps the planned order, not the exercise library's", () => {
    expect(prunePlannedWorkout(planned, ["e_row", "e_bench"])?.exerciseIds).toEqual([
      "e_bench",
      "e_row",
    ]);
  });

  it("does not mutate the plan it was given", () => {
    const input: PlannedWorkout = { name: "Heavy Bench", exerciseIds: ["e_bench", "e_row"] };
    prunePlannedWorkout(input, ["e_bench"]);
    expect(input.exerciseIds).toEqual(["e_bench", "e_row"]);
  });
});
