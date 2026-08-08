import { describe, expect, it } from "vitest";
import {
  aggregateDailyLogs,
  countSessionsTrained,
  dayKey,
  groupDayKeysByWeek,
  parseDayKey,
  weekStartKey,
} from "../daily-log";
import type { DailyLog } from "../store";

/** A week that runs Mon 2026-02-02 .. Sun 2026-02-08. */
const MON = "2026-02-02";
const TUE = "2026-02-03";
const WED = "2026-02-04";
const THU = "2026-02-05";
const FRI = "2026-02-06";
const SAT = "2026-02-07";
const SUN = "2026-02-08";
const NEXT_MON = "2026-02-09";

function log(date: string, patch: Partial<Omit<DailyLog, "date">> = {}): DailyLog {
  return { date, ...patch };
}

describe("parseDayKey", () => {
  it("round-trips with dayKey", () => {
    expect(dayKey(parseDayKey("2026-02-03"))).toBe("2026-02-03");
  });

  it("produces a LOCAL midnight, not a UTC-shifted instant", () => {
    const d = parseDayKey("2026-02-03");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(3);
    expect(d.getHours()).toBe(0);
  });
});

describe("weekStartKey", () => {
  it("maps a Monday to itself", () => {
    expect(weekStartKey(MON)).toBe(MON);
  });

  it.each([
    ["Tuesday", TUE],
    ["Wednesday", WED],
    ["Thursday", THU],
    ["Friday", FRI],
    ["Saturday", SAT],
  ])("maps %s back to the Monday that started the week", (_name, day) => {
    expect(weekStartKey(day)).toBe(MON);
  });

  it("maps SUNDAY back to the PRECEDING Monday, not the following one", () => {
    // The classic off-by-one: a Sunday-start week would bucket this with
    // 2026-02-09, splitting the weekend away from the week it belongs to.
    expect(weekStartKey(SUN)).toBe(MON);
    expect(weekStartKey(SUN)).not.toBe(NEXT_MON);
  });

  it("starts a new week on the next Monday", () => {
    expect(weekStartKey(NEXT_MON)).toBe(NEXT_MON);
  });

  it("crosses a month boundary", () => {
    // Sun 2026-03-01 belongs to the week starting Mon 2026-02-23.
    expect(weekStartKey("2026-03-01")).toBe("2026-02-23");
  });

  it("accepts a Date as well as a day key, ignoring the time of day", () => {
    expect(weekStartKey(new Date(2026, 1, 8, 23, 45))).toBe(MON);
  });
});

describe("groupDayKeysByWeek", () => {
  it("returns an empty list for no days", () => {
    expect(groupDayKeysByWeek([])).toEqual([]);
  });

  it("keeps a Sunday in the same bucket as the Monday six days earlier", () => {
    expect(groupDayKeysByWeek([SUN, MON])).toEqual([{ weekStart: MON, days: [SUN, MON] }]);
  });

  it("splits at the Monday boundary", () => {
    const weeks = groupDayKeysByWeek([SUN, NEXT_MON]);
    expect(weeks).toEqual([
      { weekStart: NEXT_MON, days: [NEXT_MON] },
      { weekStart: MON, days: [SUN] },
    ]);
  });

  it("orders weeks newest first and days newest first within a week", () => {
    const weeks = groupDayKeysByWeek([WED, NEXT_MON, MON, SUN]);
    expect(weeks.map((w) => w.weekStart)).toEqual([NEXT_MON, MON]);
    expect(weeks[1].days).toEqual([SUN, WED, MON]);
  });

  it("deduplicates repeated day keys", () => {
    expect(groupDayKeysByWeek([WED, WED, WED])).toEqual([{ weekStart: MON, days: [WED] }]);
  });

  it("skips weeks with nothing in them rather than emitting empty headers", () => {
    const weeks = groupDayKeysByWeek([MON, "2026-03-02"]);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-03-02", MON]);
  });
});

describe("aggregateDailyLogs", () => {
  it("returns null for every field when there are no logs", () => {
    const agg = aggregateDailyLogs([]);
    expect(agg.calories).toBeNull();
    expect(agg.protein).toBeNull();
    expect(agg.carbs).toBeNull();
    expect(agg.fat).toBeNull();
    expect(agg.steps).toBeNull();
    expect(agg.bodyweight).toBeNull();
  });

  it("averages over the LOGGED days only, never over all seven", () => {
    // 3 logged days out of a 7-day week. Averaging over 7 would give 1200 and
    // make a partly-tracked week look like a crash diet.
    const agg = aggregateDailyLogs([
      log(MON, { calories: 2000 }),
      log(WED, { calories: 2400 }),
      log(FRI, { calories: 2800 }),
    ]);
    expect(agg.calories).toEqual({ average: 2400, loggedDays: 3 });
  });

  it("ignores days present in the week but missing that field", () => {
    const agg = aggregateDailyLogs([
      log(MON, { calories: 2000, steps: 9000 }),
      log(TUE, { steps: 11000 }),
      log(WED, { calories: 3000, steps: 10000 }),
    ]);
    expect(agg.calories).toEqual({ average: 2500, loggedDays: 2 });
  });

  it("returns null for a field that is absent from the entire week", () => {
    const agg = aggregateDailyLogs([log(MON, { steps: 9000 }), log(TUE, { steps: 11000 })]);
    expect(agg.bodyweight).toBeNull();
    expect(agg.calories).toBeNull();
    expect(agg.steps).toEqual({ average: 10000, loggedDays: 2 });
  });

  it("treats a logged 0 as real data, counting it in BOTH the average and the count", () => {
    const agg = aggregateDailyLogs([log(MON, { steps: 0 }), log(TUE, { steps: 10000 })]);
    expect(agg.steps).toEqual({ average: 5000, loggedDays: 2 });
  });

  it("distinguishes a logged 0 from an absent field", () => {
    const zero = aggregateDailyLogs([log(MON, { calories: 0 })]);
    expect(zero.calories).toEqual({ average: 0, loggedDays: 1 });

    const absent = aggregateDailyLogs([log(MON, { calories: undefined })]);
    expect(absent.calories).toBeNull();
  });

  it("counts each field independently: steps 7 of 7, macros 3 of 7", () => {
    const days = [MON, TUE, WED, THU, FRI, SAT, SUN];
    const logs = days.map((d, i) =>
      // Steps every day; macros only on the first three.
      i < 3
        ? log(d, { steps: 10000, calories: 2100, protein: 180, carbs: 200, fat: 70 })
        : log(d, { steps: 10000 }),
    );
    const agg = aggregateDailyLogs(logs);
    expect(agg.steps).toEqual({ average: 10000, loggedDays: 7 });
    expect(agg.calories).toEqual({ average: 2100, loggedDays: 3 });
    expect(agg.protein).toEqual({ average: 180, loggedDays: 3 });
    expect(agg.carbs).toEqual({ average: 200, loggedDays: 3 });
    expect(agg.fat).toEqual({ average: 70, loggedDays: 3 });
    expect(agg.bodyweight).toBeNull();
  });

  it("does not round: the caller decides how to display a fractional average", () => {
    const agg = aggregateDailyLogs([log(MON, { bodyweight: 187 }), log(TUE, { bodyweight: 188 })]);
    expect(agg.bodyweight).toEqual({ average: 187.5, loggedDays: 2 });
  });

  it("is unaffected by cheat-day-only records", () => {
    const agg = aggregateDailyLogs([log(MON, { isCheatDay: true }), log(TUE, { calories: 2000 })]);
    expect(agg.calories).toEqual({ average: 2000, loggedDays: 1 });
  });
});

describe("countSessionsTrained", () => {
  const at = (key: string, hour = 18) => {
    const d = parseDayKey(key);
    d.setHours(hour);
    return d.getTime();
  };

  it("counts only sessions that ended inside the week", () => {
    const sessions = [
      { endedAt: at(MON) },
      { endedAt: at(WED) },
      { endedAt: at(SUN) },
      { endedAt: at(NEXT_MON) },
    ];
    expect(countSessionsTrained(sessions, MON)).toBe(3);
    expect(countSessionsTrained(sessions, NEXT_MON)).toBe(1);
  });

  it("ignores sessions that never ended", () => {
    expect(countSessionsTrained([{ endedAt: undefined }, { endedAt: at(TUE) }], MON)).toBe(1);
  });

  it("returns 0 for a week with no workouts", () => {
    expect(countSessionsTrained([{ endedAt: at(MON) }], NEXT_MON)).toBe(0);
  });

  it("puts a late Sunday workout in the week that started the preceding Monday", () => {
    expect(countSessionsTrained([{ endedAt: at(SUN, 23) }], MON)).toBe(1);
    expect(countSessionsTrained([{ endedAt: at(SUN, 23) }], NEXT_MON)).toBe(0);
  });
});
