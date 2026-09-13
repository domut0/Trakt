import { describe, expect, it } from "vitest";
import {
  isNutritionPhase,
  isPlannedDay,
  isUntrackedOn,
  phaseForDate,
  pinnedSlotIdFor,
  sortPhases,
  targetsForDate,
  type NutritionPhase,
} from "../planning";

/** The user's own stated case, which is the thing this model exists to express:
 *  maintenance now, one untracked Saturday, cutting from the Sunday onward. */
const MAINTENANCE: NutritionPhase = {
  id: "p_maint",
  startsOn: "2026-09-13",
  name: "Maintenance",
  kind: "targets",
  calories: 3400,
  steps: 20000,
};
const OFF: NutritionPhase = {
  id: "p_off",
  startsOn: "2026-09-19",
  name: "Off",
  kind: "untracked",
};
const CUT: NutritionPhase = {
  id: "p_cut",
  startsOn: "2026-09-20",
  name: "Cut",
  kind: "targets",
  calories: 3000,
  steps: 24000,
};
const PHASES = [CUT, MAINTENANCE, OFF]; // deliberately unsorted

describe("phaseForDate", () => {
  it("resolves the three-row case a day at a time", () => {
    // The whole point of the model: no end dates, and the timeline still answers
    // every day correctly because a phase runs until the next one starts.
    expect(phaseForDate(PHASES, "2026-09-13")?.id).toBe("p_maint"); // starts today
    expect(phaseForDate(PHASES, "2026-09-16")?.id).toBe("p_maint"); // mid-phase
    expect(phaseForDate(PHASES, "2026-09-18")?.id).toBe("p_maint"); // last day of it
    expect(phaseForDate(PHASES, "2026-09-19")?.id).toBe("p_off"); // the Saturday
    expect(phaseForDate(PHASES, "2026-09-20")?.id).toBe("p_cut"); // Sunday onward
    expect(phaseForDate(PHASES, "2027-06-01")?.id).toBe("p_cut"); // and forever
  });

  it("is undefined before the first phase, which is a real state", () => {
    // History logged before any plan existed. Not an error, and not a reason to
    // invent a default that would claim the user was aiming at something.
    expect(phaseForDate(PHASES, "2026-09-12")).toBeUndefined();
  });

  it("does not depend on input order", () => {
    expect(phaseForDate([...PHASES].reverse(), "2026-09-19")?.id).toBe("p_off");
  });

  it("returns nothing from an empty timeline", () => {
    expect(phaseForDate([], "2026-09-13")).toBeUndefined();
  });
});

describe("targetsForDate", () => {
  it("gives the numbers in force", () => {
    expect(targetsForDate(PHASES, "2026-09-16")).toMatchObject({ calories: 3400, steps: 20000 });
    expect(targetsForDate(PHASES, "2026-09-21")).toMatchObject({ calories: 3000, steps: 24000 });
  });

  it("gives nothing on an untracked day", () => {
    // An untracked phase resolves to undefined rather than to empty numbers, so
    // "no plan" and "deliberately not tracking" look identical to anything
    // asking what to aim at. They are told apart by isUntrackedOn instead.
    expect(targetsForDate(PHASES, "2026-09-19")).toBeUndefined();
  });
});

describe("isUntrackedOn", () => {
  it("reads a planned untracked day without any logged flag", () => {
    expect(isUntrackedOn(PHASES, "2026-09-19", undefined)).toBe(true);
  });

  it("still reads a logged flag on an ordinary day", () => {
    expect(isUntrackedOn(PHASES, "2026-09-16", true)).toBe(true);
  });

  it("is false for a tracked day with no flag", () => {
    expect(isUntrackedOn(PHASES, "2026-09-16", undefined)).toBe(false);
    expect(isUntrackedOn(PHASES, "2026-09-16", false)).toBe(false);
  });

  it("never requires a DailyLog row to exist", () => {
    // The load-bearing claim. A planned untracked day is DERIVED: nothing is
    // written for a day the user never opened, so changing the plan later
    // cannot retroactively rewrite what was recorded.
    const beforeAnyLogging = isUntrackedOn(PHASES, "2026-09-19", undefined);
    expect(beforeAnyLogging).toBe(true);
  });
});

describe("sortPhases", () => {
  it("orders by start date, oldest first", () => {
    expect(sortPhases(PHASES).map((p) => p.id)).toEqual(["p_maint", "p_off", "p_cut"]);
  });

  it("does not mutate its input", () => {
    const input = [...PHASES];
    sortPhases(input);
    expect(input.map((p) => p.id)).toEqual(["p_cut", "p_maint", "p_off"]);
  });
});

describe("pinnedSlotIdFor", () => {
  const pins = [
    { date: "2026-09-19", splitSlotId: "s_lower" },
    { date: "2026-09-21", splitSlotId: "s_upper" },
  ];

  it("finds a pin and nothing else", () => {
    expect(pinnedSlotIdFor(pins, "2026-09-19")).toBe("s_lower");
    // Never inferred: an unpinned day has no answer, rather than the rotation's
    // guess dressed up as a plan.
    expect(pinnedSlotIdFor(pins, "2026-09-20")).toBeUndefined();
  });
});

describe("backup tolerance", () => {
  it("accepts a well-formed phase", () => {
    expect(isNutritionPhase(MAINTENANCE)).toBe(true);
    expect(isNutritionPhase(OFF)).toBe(true);
  });

  it("rejects rows that would poison the timeline", () => {
    expect(isNutritionPhase({ ...MAINTENANCE, startsOn: "13/09/2026" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, startsOn: "2026-9-3" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, kind: "bulk" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, id: "" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, calories: "3400" })).toBe(false);
    expect(isNutritionPhase(null)).toBe(false);
  });

  it("accepts and rejects pins on the same terms", () => {
    expect(isPlannedDay({ date: "2026-09-19", splitSlotId: "s1" })).toBe(true);
    expect(isPlannedDay({ date: "2026-09-19", splitSlotId: "" })).toBe(false);
    expect(isPlannedDay({ date: "nope", splitSlotId: "s1" })).toBe(false);
  });
});
