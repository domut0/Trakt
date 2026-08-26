import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNED_DURATION_MINUTES,
  plannedWorkoutFor,
  prunePlannedWorkout,
  type PlannedWeek,
  type PlannedWorkout,
} from "../plan";

/**
 * The time fields the day view draws planned bands from.
 *
 * Kept in its own file rather than appended to plan.test.ts because it is
 * guarding one specific hazard: `plannedWorkoutOf` returns a NORMALIZED COPY, so
 * any field it does not name is silently dropped. A plan saves, reads back
 * without its time, draws nothing, and reports no error anywhere. There is no
 * way to notice that except by asserting the round trip, which is what every
 * test below does.
 *
 * Monday-first index 1 is Tuesday, matching plan.test.ts and targets.test.ts.
 */
const TUESDAY = "2026-08-25";

function weekWith(entry: unknown): PlannedWeek {
  return [null, entry, null, null, null, null, null] as PlannedWeek;
}

describe("atMinutes and durationMinutes round trip", () => {
  it("survives plannedWorkoutOf, which is the whole point", () => {
    const stored = {
      name: "Squat day",
      exerciseIds: ["e_squat"],
      atMinutes: 17 * 60,
      durationMinutes: 75,
    };
    expect(plannedWorkoutFor(TUESDAY, weekWith(stored))).toEqual(stored);
  });

  it("resolves a plan that has neither field, unchanged", () => {
    // The shape every plan written before the day view existed has.
    const legacy = { name: "Squat day", exerciseIds: ["e_squat"] };
    const resolved = plannedWorkoutFor(TUESDAY, weekWith(legacy));
    expect(resolved).toEqual(legacy);
    // Absent, not present-and-undefined: a plan with no time must round trip
    // through backup JSON without gaining two null keys.
    expect(Object.keys(resolved!)).toEqual(["name", "exerciseIds"]);
  });

  it("keeps the exercises when only the time is junk", () => {
    // Losing a hand-edited time should cost you the band, not the day.
    for (const bad of [-1, 1440, 99999, Number.NaN, "17:00", null, {}]) {
      const resolved = plannedWorkoutFor(
        TUESDAY,
        weekWith({ name: "Squat day", exerciseIds: ["e_squat"], atMinutes: bad }),
      );
      expect(resolved?.exerciseIds).toEqual(["e_squat"]);
      expect(resolved?.atMinutes).toBeUndefined();
    }
  });

  it("accepts the boundaries of the day", () => {
    const midnight = plannedWorkoutFor(
      TUESDAY,
      weekWith({ name: "Early", exerciseIds: ["e"], atMinutes: 0 }),
    );
    expect(midnight?.atMinutes).toBe(0);

    const lastMinute = plannedWorkoutFor(
      TUESDAY,
      weekWith({ name: "Late", exerciseIds: ["e"], atMinutes: 1439 }),
    );
    expect(lastMinute?.atMinutes).toBe(1439);
  });

  it("drops a zero or negative duration but keeps the time", () => {
    for (const bad of [0, -30]) {
      const resolved = plannedWorkoutFor(
        TUESDAY,
        weekWith({ name: "Squat day", exerciseIds: ["e"], atMinutes: 600, durationMinutes: bad }),
      );
      expect(resolved?.atMinutes).toBe(600);
      expect(resolved?.durationMinutes).toBeUndefined();
    }
  });

  it("has a default duration long enough to be a legible band", () => {
    expect(DEFAULT_PLANNED_DURATION_MINUTES).toBeGreaterThanOrEqual(30);
  });
});

describe("pruning keeps the time", () => {
  it("does not strip atMinutes when it drops a dead exercise id", () => {
    const planned: PlannedWorkout = {
      name: "Squat day",
      exerciseIds: ["e_squat", "e_gone"],
      atMinutes: 1020,
      durationMinutes: 75,
    };
    expect(prunePlannedWorkout(planned, ["e_squat"])).toEqual({
      name: "Squat day",
      exerciseIds: ["e_squat"],
      atMinutes: 1020,
      durationMinutes: 75,
    });
  });
});
