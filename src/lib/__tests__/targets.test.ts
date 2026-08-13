import { describe, expect, it } from "vitest";
import {
  isUniformWeek,
  targetProfileFor,
  targetProgressFor,
  WEEKDAY_LABELS,
  weekdayIndexFor,
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
    expect(rows[0]).toEqual({ field: "steps", logged: 0, target: 10000, fraction: 0 });
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
