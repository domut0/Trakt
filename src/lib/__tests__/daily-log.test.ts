import { describe, expect, it } from "vitest";
import { dayKey, isDailyLogEmpty } from "../daily-log";
import type { DailyLog } from "../store";

describe("dayKey", () => {
  it("formats a date as yyyy-MM-dd", () => {
    expect(dayKey(new Date(2026, 7, 7))).toBe("2026-08-07");
  });

  it("zero-pads single-digit months and days", () => {
    expect(dayKey(new Date(2026, 0, 3))).toBe("2026-01-03");
  });

  it("uses the LOCAL date, not UTC", () => {
    // 23:30 local. In any timezone behind UTC this instant is already the next
    // day in UTC, so a toISOString()-based key would report the wrong day.
    const late = new Date(2026, 2, 15, 23, 30, 0);
    expect(dayKey(late)).toBe("2026-03-15");
    expect(dayKey(late)).toBe(
      `${late.getFullYear()}-${String(late.getMonth() + 1).padStart(2, "0")}-${String(
        late.getDate(),
      ).padStart(2, "0")}`,
    );
  });
});

describe("isDailyLogEmpty", () => {
  const base: DailyLog = { date: "2026-08-07" };

  it("treats a record with only a date as empty", () => {
    expect(isDailyLogEmpty(base)).toBe(true);
  });

  it("treats every numeric field explicitly undefined as empty", () => {
    expect(
      isDailyLogEmpty({
        ...base,
        calories: undefined,
        protein: undefined,
        carbs: undefined,
        fat: undefined,
        steps: undefined,
        bodyweight: undefined,
        isCheatDay: undefined,
      }),
    ).toBe(true);
  });

  it("treats isCheatDay: false as still empty", () => {
    expect(isDailyLogEmpty({ ...base, isCheatDay: false })).toBe(true);
  });

  it("treats isCheatDay: true as NOT empty", () => {
    expect(isDailyLogEmpty({ ...base, isCheatDay: true })).toBe(false);
  });

  it.each([
    ["calories", { calories: 0 }],
    ["protein", { protein: 0 }],
    ["carbs", { carbs: 0 }],
    ["fat", { fat: 0 }],
    ["steps", { steps: 0 }],
    ["bodyweight", { bodyweight: 0 }],
  ] as const)("treats a literal 0 in %s as NOT empty", (_field, patch) => {
    expect(isDailyLogEmpty({ ...base, ...patch })).toBe(false);
  });

  it("treats a 0 alongside isCheatDay: false as NOT empty", () => {
    expect(isDailyLogEmpty({ ...base, steps: 0, isCheatDay: false })).toBe(false);
  });

  it.each([
    ["calories", { calories: 2400 }],
    ["protein", { protein: 190 }],
    ["carbs", { carbs: 250 }],
    ["fat", { fat: 70 }],
    ["steps", { steps: 8123 }],
    ["bodyweight", { bodyweight: 187.5 }],
  ] as const)("treats a real value in %s as NOT empty", (_field, patch) => {
    expect(isDailyLogEmpty({ ...base, ...patch })).toBe(false);
  });

  it("treats a negative value as NOT empty (it is still a logged number)", () => {
    expect(isDailyLogEmpty({ ...base, bodyweight: -1 })).toBe(false);
  });
});
