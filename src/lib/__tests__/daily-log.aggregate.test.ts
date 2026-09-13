import { describe, expect, it } from "vitest";
import { dayKey, parseDayKey, weekStartKey } from "../daily-log";

/** A week that runs Mon 2026-02-02 .. Sun 2026-02-08. */
const MON = "2026-02-02";
const TUE = "2026-02-03";
const WED = "2026-02-04";
const THU = "2026-02-05";
const FRI = "2026-02-06";
const SAT = "2026-02-07";
const SUN = "2026-02-08";
const NEXT_MON = "2026-02-09";

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
