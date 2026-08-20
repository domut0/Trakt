import { describe, expect, it } from "vitest";
import {
  BAND_TOLERANCE,
  DEFAULT_GOAL_MODE,
  directionFor,
  GOAL_MODES,
  isUniformWeek,
  TARGET_FIELDS,
  targetProfileFor,
  targetProgressFor,
  targetStatusFor,
  WEEKDAY_LABELS,
  weekdayIndexFor,
  type GoalMode,
  type TargetDirection,
  type TargetField,
} from "../targets";
import type { DailyLog, TargetProfile } from "../store";

/**
 * 2026-08-10 is a Monday and 2026-08-16 the Sunday that closes the same week,
 * so this is one full Monday-to-Sunday week with no month boundary in it.
 * Every index below was worked out from the real calendar, not from the
 * implementation.
 */
const MON_TO_SUN = [
  { key: "2026-08-10", label: "Mon", expected: 0 },
  { key: "2026-08-11", label: "Tue", expected: 1 },
  { key: "2026-08-12", label: "Wed", expected: 2 },
  { key: "2026-08-13", label: "Thu", expected: 3 },
  { key: "2026-08-14", label: "Fri", expected: 4 },
  { key: "2026-08-15", label: "Sat", expected: 5 },
  { key: "2026-08-16", label: "Sun", expected: 6 },
] as const;

describe("weekdayIndexFor", () => {
  it.each(MON_TO_SUN)("maps $key ($label) to Monday-first index $expected", ({ key, expected }) => {
    expect(weekdayIndexFor(key)).toBe(expected);
  });

  it("rotates away from the Sunday-first getDay, not just on Monday", () => {
    // The failure mode this guards: indexing with a raw getDay() is CORRECT on
    // Monday and wrong the other six days, so a Monday-only check passes a
    // broken implementation. Assert the whole week in one shot.
    expect(MON_TO_SUN.map((d) => weekdayIndexFor(d.key))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // getDay would produce this instead. If the two ever match, the rotation
    // has been dropped.
    const sundayFirst = MON_TO_SUN.map((d) => new Date(`${d.key}T00:00:00`).getDay());
    expect(sundayFirst).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(MON_TO_SUN.map((d) => weekdayIndexFor(d.key))).not.toEqual(sundayFirst);
  });

  it("puts Sunday last and Monday first at the week boundary", () => {
    // 2026-08-09 is the Sunday BEFORE this week and 2026-08-10 the Monday that
    // starts it: consecutive dates that must land on opposite ends.
    expect(weekdayIndexFor("2026-08-09")).toBe(6);
    expect(weekdayIndexFor("2026-08-10")).toBe(0);
  });

  it("agrees with WEEKDAY_LABELS", () => {
    for (const { key, label } of MON_TO_SUN) {
      expect(WEEKDAY_LABELS[weekdayIndexFor(key)]).toBe(label);
    }
  });

  it("accepts a Date as well as a day key", () => {
    // Local-constructed Date, month is 0-based: 2026-08-12, a Wednesday.
    expect(weekdayIndexFor(new Date(2026, 7, 12))).toBe(2);
  });

  it("ignores the time of day", () => {
    // 23:45 local on a Wednesday is still Wednesday. A UTC-based conversion
    // would roll this to Thursday for anyone west of UTC.
    expect(weekdayIndexFor(new Date(2026, 7, 12, 23, 45))).toBe(2);
    expect(weekdayIndexFor(new Date(2026, 7, 12, 0, 5))).toBe(2);
  });

  it("stays correct across a month boundary", () => {
    // 2026-03-01 is a Sunday, so it closes the week its own month opens.
    expect(weekdayIndexFor("2026-03-01")).toBe(6);
    expect(weekdayIndexFor("2025-12-31")).toBe(2);
  });
});

describe("targetProfileFor", () => {
  const training: TargetProfile = { id: "tp_train", name: "Training", calories: 3200 };
  const rest: TargetProfile = { id: "tp_rest", name: "Rest", calories: 2400 };
  const profiles = [training, rest];

  /** Training on Mon/Wed/Fri, Rest on the rest. MONDAY FIRST. */
  const week = ["tp_train", "tp_rest", "tp_train", "tp_rest", "tp_train", "tp_rest", "tp_rest"];

  it("resolves each weekday to its assigned profile", () => {
    expect(targetProfileFor("2026-08-10", profiles, week)).toBe(training); // Mon
    expect(targetProfileFor("2026-08-11", profiles, week)).toBe(rest); // Tue
    expect(targetProfileFor("2026-08-12", profiles, week)).toBe(training); // Wed
    expect(targetProfileFor("2026-08-14", profiles, week)).toBe(training); // Fri
    expect(targetProfileFor("2026-08-16", profiles, week)).toBe(rest); // Sun
  });

  it("reads the array Monday-first, so Sunday takes the LAST slot", () => {
    // Distinct profile in slot 6 only. A Sunday-first lookup would read slot 0
    // here and wrongly return Training.
    const marker: TargetProfile = { id: "tp_sun", name: "Sunday", calories: 1800 };
    const sundayOnly = [...week];
    sundayOnly[6] = marker.id;
    expect(targetProfileFor("2026-08-16", [...profiles, marker], sundayOnly)).toBe(marker);
    expect(targetProfileFor("2026-08-10", [...profiles, marker], sundayOnly)).toBe(training);
  });

  it("returns undefined for a stale id rather than falling back to a profile", () => {
    // What a hand-edited backup looks like after a profile was deleted
    // elsewhere. Silently substituting profiles[0] would show a target the user
    // never assigned.
    const stale = [...week];
    stale[2] = "tp_deleted";
    expect(targetProfileFor("2026-08-12", profiles, stale)).toBeUndefined();
    // The untouched days still resolve.
    expect(targetProfileFor("2026-08-10", profiles, stale)).toBe(training);
  });

  it("returns undefined for a short array instead of throwing", () => {
    expect(targetProfileFor("2026-08-10", profiles, [])).toBeUndefined();
    expect(targetProfileFor("2026-08-10", profiles, ["tp_train"])).toBeUndefined();
    expect(targetProfileFor("2026-08-16", profiles, ["tp_train", "tp_rest"])).toBeUndefined();
  });

  it("returns undefined for an over-long array instead of using the first 7", () => {
    // Wrong length is wrong data. Guessing which 7 of 8 were meant is worse
    // than reporting no target.
    expect(targetProfileFor("2026-08-10", profiles, [...week, "tp_rest"])).toBeUndefined();
  });

  it("returns undefined when there are no profiles at all", () => {
    expect(targetProfileFor("2026-08-10", [], week)).toBeUndefined();
  });

  it("never throws on any malformed input across a whole week", () => {
    const malformed: string[][] = [
      [],
      ["tp_train"],
      Array.from({ length: 7 }, () => "tp_gone"),
      Array.from({ length: 8 }, () => "tp_train"),
    ];
    for (const weekdayTargets of malformed) {
      for (const { key } of MON_TO_SUN) {
        expect(() => targetProfileFor(key, profiles, weekdayTargets)).not.toThrow();
      }
    }
  });
});

describe("targetProgressFor", () => {
  const log: DailyLog = {
    date: "2026-08-12",
    calories: 2800,
    protein: 180,
    steps: 4000,
  };

  it("returns a row only where both a target and a logged value exist", () => {
    const profile: TargetProfile = {
      id: "tp_1",
      name: "Training",
      calories: 3200,
      protein: 200,
      // carbs targeted but never logged, so no row.
      carbs: 400,
    };
    expect(targetProgressFor(log, profile).map((p) => p.field)).toEqual(["calories", "protein"]);
  });

  it("computes an unclamped fraction so going over is visible", () => {
    const profile: TargetProfile = { id: "tp_1", name: "Cut", calories: 2000 };
    const [row] = targetProgressFor(log, profile);
    expect(row.fraction).toBe(1.4);
    expect(row.logged).toBe(2800);
    expect(row.target).toBe(2000);
  });

  it("treats a target of 0 as unset rather than emitting Infinity", () => {
    // A stray 0 from a blanked input must not reach the progress rows: 2800/0
    // is Infinity and would render a broken bar.
    const profile: TargetProfile = { id: "tp_1", name: "Zero", calories: 0, protein: 200 };
    const rows = targetProgressFor(log, profile);
    expect(rows.map((r) => r.field)).toEqual(["protein"]);
    expect(rows.every((r) => Number.isFinite(r.fraction))).toBe(true);
  });

  it("treats a negative target as unset too", () => {
    const profile: TargetProfile = { id: "tp_1", name: "Bad", calories: -100 };
    expect(targetProgressFor(log, profile)).toEqual([]);
  });

  it("keeps a LOGGED 0, which is a real measurement", () => {
    // 0 steps is something the user actually recorded, unlike a target of 0.
    const zeroSteps: DailyLog = { date: "2026-08-12", steps: 0 };
    const profile: TargetProfile = { id: "tp_1", name: "Training", steps: 10000 };
    const rows = targetProgressFor(zeroSteps, profile);
    expect(rows).toHaveLength(1);
    // Exact shape on purpose: a field added to TargetProgress and forgotten in
    // targetProgressFor fails here without anyone having to remember to assert
    // it. Steps are a floor in every mode, and 0 of 10,000 has not been reached,
    // so this is "progress" with a delta of the whole goal still to go.
    expect(rows[0]).toEqual({
      field: "steps",
      logged: 0,
      target: 10000,
      fraction: 0,
      direction: "floor",
      status: "progress",
      delta: -10000,
    });
  });

  it("returns nothing without a log or without a profile", () => {
    const profile: TargetProfile = { id: "tp_1", name: "Training", calories: 3200 };
    expect(targetProgressFor(undefined, profile)).toEqual([]);
    expect(targetProgressFor(log, undefined)).toEqual([]);
    expect(targetProgressFor(undefined, undefined)).toEqual([]);
  });

  it("emits rows in TARGET_FIELDS order, not object-key order", () => {
    const full: DailyLog = {
      date: "2026-08-12",
      steps: 9000,
      fat: 70,
      carbs: 300,
      protein: 190,
      calories: 3000,
    };
    const profile: TargetProfile = {
      id: "tp_1",
      name: "Training",
      steps: 10000,
      fat: 80,
      carbs: 350,
      protein: 200,
      calories: 3200,
    };
    expect(targetProgressFor(full, profile).map((p) => p.field)).toEqual([
      "calories",
      "protein",
      "carbs",
      "fat",
      "steps",
    ]);
  });

  it("ignores bodyweight, which is an outcome and not a target", () => {
    const withWeight: DailyLog = { date: "2026-08-12", bodyweight: 185 };
    const profile: TargetProfile = { id: "tp_1", name: "Training", calories: 3200 };
    expect(targetProgressFor(withWeight, profile)).toEqual([]);
  });
});

describe("directionFor", () => {
  /**
   * The whole table, written out from the spec rather than read back off the
   * implementation. If a direction is ever "simplified" into a rule, this is
   * what stops it.
   */
  const TABLE: Record<GoalMode, Record<TargetField, TargetDirection>> = {
    cut: { calories: "ceiling", protein: "floor", carbs: "band", fat: "ceiling", steps: "floor" },
    maintain: { calories: "band", protein: "floor", carbs: "band", fat: "band", steps: "floor" },
    gain: { calories: "floor", protein: "floor", carbs: "band", fat: "band", steps: "floor" },
  };

  const CASES = GOAL_MODES.flatMap((mode) =>
    TARGET_FIELDS.map((field) => ({ mode, field, expected: TABLE[mode][field] })),
  );

  it.each(CASES)("$mode / $field is a $expected", ({ mode, field, expected }) => {
    expect(directionFor(field, mode)).toBe(expected);
  });

  it("makes protein a floor in EVERY mode, which is the reported bug", () => {
    // The user's complaint verbatim: beating a protein goal was painted red.
    // There is no diet in which more protein than planned is a failure.
    for (const mode of GOAL_MODES) {
      expect(directionFor("protein", mode)).toBe("floor");
    }
  });

  it("makes steps a floor in EVERY mode", () => {
    for (const mode of GOAL_MODES) {
      expect(directionFor("steps", mode)).toBe("floor");
    }
  });

  it("never makes protein or steps a ceiling, however the table is edited", () => {
    // Stronger than the two above: a future mode added to GOAL_MODES is covered
    // automatically, because walking off with a ceiling on either field is the
    // specific mistake being guarded, not the current table's contents.
    for (const mode of GOAL_MODES) {
      expect(directionFor("protein", mode)).not.toBe("ceiling");
      expect(directionFor("steps", mode)).not.toBe("ceiling");
    }
  });

  it("inverts calories between cut and gain, which no single global rule can serve", () => {
    expect(directionFor("calories", "cut")).toBe("ceiling");
    expect(directionFor("calories", "gain")).toBe("floor");
  });

  it("defaults an absent mode to maintain rather than throwing or guessing", () => {
    for (const field of TARGET_FIELDS) {
      expect(directionFor(field, undefined)).toBe(directionFor(field, DEFAULT_GOAL_MODE));
    }
    expect(DEFAULT_GOAL_MODE).toBe("maintain");
  });

  it("degrades an unrecognised mode to the default instead of returning undefined", () => {
    // What a hand-edited backup or a file from a future version looks like.
    // `goalMode` round-trips through user-editable JSON, so the type annotation
    // guarantees nothing at runtime.
    const junk = ["", "CUT", "bulk", "banana", "null"] as unknown as GoalMode[];
    for (const mode of junk) {
      for (const field of TARGET_FIELDS) {
        expect(directionFor(field, mode)).toBe(directionFor(field, DEFAULT_GOAL_MODE));
      }
    }
  });

  it("survives non-string junk in the mode slot", () => {
    const junk = [null, 0, 1, {}, [], true] as unknown as GoalMode[];
    for (const mode of junk) {
      expect(() => directionFor("calories", mode)).not.toThrow();
      expect(directionFor("calories", mode)).toBe("band");
    }
  });

  it("returns a valid direction for every field in every mode", () => {
    const valid: TargetDirection[] = ["floor", "ceiling", "band"];
    for (const mode of [...GOAL_MODES, undefined]) {
      for (const field of TARGET_FIELDS) {
        expect(valid).toContain(directionFor(field, mode));
      }
    }
  });
});

describe("targetStatusFor", () => {
  describe("floor", () => {
    it("is progress below target", () => {
      expect(targetStatusFor("floor", 7999, 8000)).toBe("progress");
      expect(targetStatusFor("floor", 0, 8000)).toBe("progress");
    });

    it("is met exactly AT target", () => {
      expect(targetStatusFor("floor", 8000, 8000)).toBe("met");
    });

    it("is met above target — a floor cannot be overshot", () => {
      expect(targetStatusFor("floor", 9400, 8000)).toBe("met");
      expect(targetStatusFor("floor", 80000, 8000)).toBe("met");
    });

    it("NEVER reports exceeded, at any magnitude", () => {
      // The precise regression: `fraction > 1` used to fire here and stamp
      // "OVER" on a 10x step day.
      for (const logged of [8000, 8001, 9400, 16000, 1e6]) {
        expect(targetStatusFor("floor", logged, 8000)).not.toBe("exceeded");
      }
    });
  });

  describe("ceiling", () => {
    it("is progress below target", () => {
      expect(targetStatusFor("ceiling", 1200, 2000)).toBe("progress");
      expect(targetStatusFor("ceiling", 0, 2000)).toBe("progress");
    });

    it("is progress exactly AT target — spending the budget is not breaking it", () => {
      expect(targetStatusFor("ceiling", 2000, 2000)).toBe("progress");
    });

    it("is exceeded one unit over", () => {
      expect(targetStatusFor("ceiling", 2001, 2000)).toBe("exceeded");
      expect(targetStatusFor("ceiling", 2800, 2000)).toBe("exceeded");
    });

    it("NEVER reports met, because being under budget at 9am is not an achievement", () => {
      // If a ceiling could go green, green would mean both "you did it" and
      // "you have not started", and would therefore mean nothing.
      for (const logged of [0, 1, 500, 1999, 2000]) {
        expect(targetStatusFor("ceiling", logged, 2000)).not.toBe("met");
      }
    });
  });

  describe("band", () => {
    it("is met exactly ON target", () => {
      expect(targetStatusFor("band", 2000, 2000)).toBe("met");
    });

    it("is met at BOTH edges, exactly at tolerance", () => {
      // 5% of 2000 is 100, so 1900 and 2100 are the inclusive edges.
      expect(targetStatusFor("band", 2100, 2000)).toBe("met");
      expect(targetStatusFor("band", 1900, 2000)).toBe("met");
    });

    it("is met at a fractional tolerance edge too", () => {
      // 5% of 350 is 17.5 — a non-integer edge, where a sloppier comparison
      // would be at the mercy of float rounding.
      expect(targetStatusFor("band", 367.5, 350)).toBe("met");
      expect(targetStatusFor("band", 332.5, 350)).toBe("met");
    });

    it("is exceeded just past the upper edge", () => {
      expect(targetStatusFor("band", 2101, 2000)).toBe("exceeded");
      expect(targetStatusFor("band", 368, 350)).toBe("exceeded");
    });

    it("is progress just below the lower edge", () => {
      expect(targetStatusFor("band", 1899, 2000)).toBe("progress");
      expect(targetStatusFor("band", 0, 2000)).toBe("progress");
    });

    it("does not lose the edge to float error on the fraction", () => {
      // The trap this guards: `1.05 - 1` is 0.050000000000000044, so comparing
      // `Math.abs(fraction - 1) <= BAND_TOLERANCE` reports "exceeded" for a value
      // sitting exactly on the edge. Comparing in the field's own units is exact.
      expect(1.05 - 1).toBeGreaterThan(BAND_TOLERANCE);
      for (const target of [200, 350, 2000, 2750, 3200, 10000]) {
        const upper = target * (1 + BAND_TOLERANCE);
        const lower = target * (1 - BAND_TOLERANCE);
        expect(targetStatusFor("band", upper, target)).toBe("met");
        expect(targetStatusFor("band", lower, target)).toBe("met");
      }
    });

    it("uses a tolerance that scales with the target, not a fixed number of units", () => {
      // 100 over a 2000 goal is the edge; 100 over a 200 goal is nowhere near it.
      expect(targetStatusFor("band", 2100, 2000)).toBe("met");
      expect(targetStatusFor("band", 300, 200)).toBe("exceeded");
      expect(BAND_TOLERANCE).toBe(0.05);
    });
  });

  it("returns one of the three statuses for every direction and any input", () => {
    const statuses = ["progress", "met", "exceeded"];
    for (const direction of ["floor", "ceiling", "band"] as TargetDirection[]) {
      for (const logged of [0, 1, 1999, 2000, 2001, 1e9]) {
        expect(statuses).toContain(targetStatusFor(direction, logged, 2000));
      }
    }
  });
});

describe("targetProgressFor direction and status", () => {
  it("calls a step surplus MET, with a positive delta", () => {
    // The headline case from the bug report: 9,400 steps against an 8,000 goal
    // is a good day, and used to render as a red bar stamped OVER.
    const log: DailyLog = { date: "2026-08-12", steps: 9400 };
    const profile: TargetProfile = { id: "tp_1", name: "Daily", steps: 8000 };
    const [row] = targetProgressFor(log, profile);
    expect(row.direction).toBe("floor");
    expect(row.status).toBe("met");
    expect(row.delta).toBe(1400);
    // The fraction is untouched and still unclamped — only its interpretation moved.
    expect(row.fraction).toBe(1.175);
  });

  it("calls a calorie breach on a cut EXCEEDED, with a positive delta", () => {
    const log: DailyLog = { date: "2026-08-12", calories: 2800 };
    const profile: TargetProfile = { id: "tp_1", name: "Cut", calories: 2000, goalMode: "cut" };
    const [row] = targetProgressFor(log, profile);
    expect(row.direction).toBe("ceiling");
    expect(row.status).toBe("exceeded");
    expect(row.delta).toBe(800);
    expect(row.fraction).toBe(1.4);
  });

  it("splits protein and calories on the SAME cut day, which the old rule could not", () => {
    // One day, both fields over target. `fraction > 1` painted both red; the
    // truth is that one is a win and the other is the miss.
    const log: DailyLog = { date: "2026-08-12", calories: 2800, protein: 220 };
    const profile: TargetProfile = {
      id: "tp_1",
      name: "Cut",
      calories: 2000,
      protein: 200,
      goalMode: "cut",
    };
    const rows = targetProgressFor(log, profile);
    expect(rows.map((r) => [r.field, r.status])).toEqual([
      ["calories", "exceeded"],
      ["protein", "met"],
    ]);
    // Both are over 1.0. The fraction alone genuinely cannot tell them apart,
    // which is why direction had to become part of the model.
    expect(rows.every((r) => r.fraction > 1)).toBe(true);
  });

  it("inverts the calorie verdict between cut and gain for the identical log", () => {
    const log: DailyLog = { date: "2026-08-12", calories: 3400 };
    const base = { id: "tp_1", name: "P", calories: 3000 };
    const cut = targetProgressFor(log, { ...base, goalMode: "cut" })[0];
    const gain = targetProgressFor(log, { ...base, goalMode: "gain" })[0];
    expect(cut.status).toBe("exceeded");
    expect(gain.status).toBe("met");
    // Same number, same target, same fraction — opposite meaning.
    expect(cut.fraction).toBe(gain.fraction);
    expect(cut.delta).toBe(gain.delta);
  });

  it("defaults a profile with no goalMode to maintain", () => {
    const log: DailyLog = { date: "2026-08-12", calories: 3400, protein: 220, steps: 9400 };
    const legacy: TargetProfile = {
      id: "tp_1",
      name: "Legacy",
      calories: 3000,
      protein: 200,
      steps: 8000,
    };
    const explicit: TargetProfile = { ...legacy, goalMode: "maintain" };
    expect(targetProgressFor(log, legacy)).toEqual(targetProgressFor(log, explicit));
    // Under maintain, calories are a band: 3400 is 13% over 3000, so it breaches.
    const rows = targetProgressFor(log, legacy);
    expect(rows.map((r) => [r.field, r.direction, r.status])).toEqual([
      ["calories", "band", "exceeded"],
      ["protein", "floor", "met"],
      ["steps", "floor", "met"],
    ]);
  });

  it("resolves the default ON READ and never stamps it onto the profile", () => {
    // The zero-migration promise: an existing saved profile is fixed without
    // being rewritten. Writing the default back would also mean a stored file
    // that changed shape merely by being looked at.
    const legacy: TargetProfile = { id: "tp_1", name: "Legacy", calories: 3000 };
    const before = JSON.stringify(legacy);
    targetProgressFor({ date: "2026-08-12", calories: 2900 }, legacy);
    expect(JSON.stringify(legacy)).toBe(before);
    expect("goalMode" in legacy).toBe(false);
    expect(legacy.goalMode).toBeUndefined();
  });

  it("degrades a profile carrying a junk goalMode to maintain instead of throwing", () => {
    // A hand-edited backup. parseBackup does not validate goalMode, so this
    // shape genuinely reaches here.
    const imported = {
      id: "tp_1",
      name: "Imported",
      calories: 3000,
      protein: 200,
      goalMode: "shredding",
    } as unknown as TargetProfile;
    const log: DailyLog = { date: "2026-08-12", calories: 3400, protein: 220 };
    expect(() => targetProgressFor(log, imported)).not.toThrow();
    const rows = targetProgressFor(log, imported);
    expect(rows.map((r) => [r.field, r.direction, r.status])).toEqual([
      ["calories", "band", "exceeded"],
      ["protein", "floor", "met"],
    ]);
  });

  it("puts a band field exactly on its tolerance edge into met, end to end", () => {
    // 5% of 350 carbs is 17.5, so 367.5 is the inclusive upper edge and 332.5
    // the lower one. Both are met; one gram further out is not.
    const profile: TargetProfile = { id: "tp_1", name: "Maintain", carbs: 350 };
    const at = (carbs: number) => targetProgressFor({ date: "2026-08-12", carbs }, profile)[0];
    expect(at(367.5).status).toBe("met");
    expect(at(332.5).status).toBe("met");
    expect(at(350).status).toBe("met");
    expect(at(368).status).toBe("exceeded");
    expect(at(332).status).toBe("progress");
    expect(at(367.5).delta).toBe(17.5);
  });

  it("gives every row a direction, a status and a delta", () => {
    const log: DailyLog = {
      date: "2026-08-12",
      calories: 2900,
      protein: 190,
      carbs: 300,
      fat: 70,
      steps: 9400,
    };
    const profile: TargetProfile = {
      id: "tp_1",
      name: "Cut",
      calories: 3000,
      protein: 200,
      carbs: 300,
      fat: 80,
      steps: 8000,
      goalMode: "cut",
    };
    const rows = targetProgressFor(log, profile);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.direction).toBe(directionFor(row.field, "cut"));
      expect(row.delta).toBe(row.logged - row.target);
      expect(["progress", "met", "exceeded"]).toContain(row.status);
    }
    expect(rows.map((r) => r.status)).toEqual(["progress", "progress", "met", "progress", "met"]);
  });

  it("keeps delta signed, so a shortfall is negative", () => {
    const log: DailyLog = { date: "2026-08-12", protein: 150 };
    const profile: TargetProfile = { id: "tp_1", name: "P", protein: 200 };
    const [row] = targetProgressFor(log, profile);
    expect(row.status).toBe("progress");
    expect(row.delta).toBe(-50);
  });

  it("agrees with targetStatusFor for every mode and field it emits", () => {
    // Cross-check: the row builder must not grow its own copy of the rules.
    const log: DailyLog = {
      date: "2026-08-12",
      calories: 3400,
      protein: 220,
      carbs: 300,
      fat: 95,
      steps: 9400,
    };
    for (const goalMode of GOAL_MODES) {
      const profile: TargetProfile = {
        id: "tp_1",
        name: goalMode,
        calories: 3000,
        protein: 200,
        carbs: 300,
        fat: 80,
        steps: 8000,
        goalMode,
      };
      for (const row of targetProgressFor(log, profile)) {
        expect(row.status).toBe(targetStatusFor(row.direction, row.logged, row.target));
      }
    }
  });
});

describe("isUniformWeek", () => {
  const same = (id: string) => Array.from({ length: 7 }, () => id);

  it("is true when all seven days share one profile", () => {
    expect(isUniformWeek(same("tp_1"))).toBe(true);
  });

  it("is false as soon as one day differs", () => {
    const week = same("tp_1");
    week[6] = "tp_2"; // Sunday
    expect(isUniformWeek(week)).toBe(false);
    const monday = same("tp_1");
    monday[0] = "tp_2";
    expect(isUniformWeek(monday)).toBe(false);
  });

  it("is false for a wrong-length array, including an empty one", () => {
    // An empty array has a 0-size Set, and a 3-element identical array is
    // uniform-looking but still corrupt. Neither may read as the simple case.
    expect(isUniformWeek([])).toBe(false);
    expect(isUniformWeek(["tp_1"])).toBe(false);
    expect(isUniformWeek(Array.from({ length: 3 }, () => "tp_1"))).toBe(false);
    expect(isUniformWeek(Array.from({ length: 8 }, () => "tp_1"))).toBe(false);
  });

  it("says nothing about whether the id resolves", () => {
    // Uniformly pointing at a deleted profile is still a uniform week. The
    // editor pairs this with a profile-count check so a broken week can still
    // be repaired.
    expect(isUniformWeek(same("tp_deleted"))).toBe(true);
  });
});
