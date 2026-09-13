import { describe, expect, it } from "vitest";
import {
  CEILING_TOLERANCE,
  TARGET_FIELDS,
  directionFor,
  targetProgressFor,
  targetStatusFor,
} from "../targets";
import type { DailyLog } from "../store";

/**
 * Two rules, where there used to be nine.
 *
 *   Calories are a CEILING: hit them, or come in a little under.
 *   Steps are a FLOOR: hit them, or go past.
 *   Macros are judged not at all.
 *
 * The cut / maintain / gain dial this replaced flipped each macro between
 * floor, ceiling and band. It is gone because there is no more-or-less-is-better
 * rule for a macro: it is a number you aim at, and missing it in either
 * direction is just missing it.
 */

const log = (patch: Partial<DailyLog>): DailyLog => ({ date: "2026-09-13", ...patch });

describe("directionFor", () => {
  it("judges only calories and steps", () => {
    expect(directionFor("calories")).toBe("ceiling");
    expect(directionFor("steps")).toBe("floor");
  });

  it("returns nothing for every macro", () => {
    // Undefined is load-bearing rather than a default: a caller that gets it
    // back must render NO mark, not a neutral one.
    expect(directionFor("protein")).toBeUndefined();
    expect(directionFor("carbs")).toBeUndefined();
    expect(directionFor("fat")).toBeUndefined();
  });

  it("has an answer, or a deliberate non-answer, for every target field", () => {
    // A new field added to TARGET_FIELDS without a decision here would silently
    // fall into the unjudged bucket, which is the safe direction but should be
    // a choice rather than an accident.
    for (const f of TARGET_FIELDS) {
      expect(() => directionFor(f)).not.toThrow();
    }
  });
});

describe("targetStatusFor: a floor", () => {
  it("is met on the number and past it", () => {
    expect(targetStatusFor("floor", 20000, 20000)).toBe("met");
    expect(targetStatusFor("floor", 26000, 20000)).toBe("met");
  });

  it("is never exceeded, because more is the point", () => {
    // There is no such thing as too many steps, so a floor has only two states.
    expect(targetStatusFor("floor", 99999, 20000)).not.toBe("exceeded");
  });

  it("is in progress below the number", () => {
    expect(targetStatusFor("floor", 19999, 20000)).toBe("progress");
  });
});

describe("targetStatusFor: a ceiling", () => {
  it("is met on the number", () => {
    expect(targetStatusFor("ceiling", 2400, 2400)).toBe("met");
  });

  it("is met slightly under, which is the whole point of the tolerance", () => {
    // "Hit them or slightly below" needs a floor under the "slightly", or met
    // would be unreachable in practice: landing exactly on a calorie target
    // essentially never happens.
    const target = 2400;
    const justUnder = target * (1 - CEILING_TOLERANCE);
    expect(targetStatusFor("ceiling", justUnder, target)).toBe("met");
    expect(targetStatusFor("ceiling", target - 1, target)).toBe("met");
  });

  it("is only in progress well under", () => {
    const target = 2400;
    expect(targetStatusFor("ceiling", target * (1 - CEILING_TOLERANCE) - 1, target)).toBe(
      "progress",
    );
    expect(targetStatusFor("ceiling", 1200, target)).toBe("progress");
  });

  it("is exceeded one over and no sooner", () => {
    expect(targetStatusFor("ceiling", 2401, 2400)).toBe("exceeded");
    expect(targetStatusFor("ceiling", 3000, 2400)).toBe("exceeded");
  });
});

describe("targetProgressFor", () => {
  const phase = { calories: 2400, protein: 210, carbs: 210, fat: 70, steps: 24000 };

  it("reports only the judged fields", () => {
    const rows = targetProgressFor(
      log({ calories: 2300, protein: 180, carbs: 250, fat: 80, steps: 26000 }),
      phase,
    );
    // Macros are logged, targeted, and still absent: they have no verdict to
    // give, so they produce no row rather than a row with a neutral one.
    expect(rows.map((r) => r.field).sort()).toEqual(["calories", "steps"]);
  });

  it("carries direction and status per row so callers never re-derive them", () => {
    const rows = targetProgressFor(log({ calories: 2600, steps: 26000 }), phase);
    const cals = rows.find((r) => r.field === "calories")!;
    const steps = rows.find((r) => r.field === "steps")!;

    expect(cals.direction).toBe("ceiling");
    expect(cals.status).toBe("exceeded");
    expect(cals.delta).toBe(200);

    expect(steps.direction).toBe("floor");
    expect(steps.status).toBe("met");
    expect(steps.delta).toBe(2000);
  });

  it("does not clamp the fraction, because going over is real information", () => {
    const rows = targetProgressFor(log({ calories: 4800 }), phase);
    expect(rows[0].fraction).toBe(2);
  });

  it("needs both halves", () => {
    // A target with nothing logged, and a logged value with no target, both
    // yield nothing: progress is a comparison and one number is not one.
    expect(targetProgressFor(log({}), phase)).toEqual([]);
    expect(targetProgressFor(log({ calories: 2300 }), {})).toEqual([]);
    expect(targetProgressFor(undefined, phase)).toEqual([]);
    expect(targetProgressFor(log({ calories: 2300 }), undefined)).toEqual([]);
  });

  it("treats a target of 0 as unset rather than as a goal", () => {
    // Dividing by it yields Infinity, and "eat zero calories" is not a target
    // anyone set on purpose.
    expect(targetProgressFor(log({ calories: 2300 }), { calories: 0 })).toEqual([]);
  });

  it("counts a logged 0 as real", () => {
    // 0 steps is a meaningful thing to have recorded, unlike an absent value.
    const rows = targetProgressFor(log({ steps: 0 }), phase);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("progress");
  });
});
