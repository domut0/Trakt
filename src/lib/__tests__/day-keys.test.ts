import { describe, expect, it } from "vitest";
import { addDaysToKey, daysBetweenKeys, durationLabel } from "../planning";

/**
 * Day-key arithmetic, and how a span of days is said out loud.
 *
 * This file used to be about the RIBBON's geometry - the widths of a drawn
 * timeline, and the flag it set when a segment's width was a lie about how long
 * a phase was. The ribbon is gone (see NutritionPlan.tsx), and with it the only
 * place in the app where a drawing made a claim about a quantity. What is left
 * is the arithmetic underneath it, which the phase list still runs on.
 */

describe("day arithmetic", () => {
  it("counts whole days between keys", () => {
    expect(daysBetweenKeys("2026-09-13", "2026-09-20")).toBe(7);
    expect(daysBetweenKeys("2026-09-20", "2026-09-13")).toBe(-7);
    expect(daysBetweenKeys("2026-09-13", "2026-09-13")).toBe(0);
  });

  it("crosses a month, a year and a leap day", () => {
    expect(daysBetweenKeys("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetweenKeys("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetweenKeys("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("is unmoved by a DST boundary", () => {
    // The whole reason this works in UTC. In a local-time subtraction these
    // spans are 23 and 25 hours, and Math.round would still be right - but
    // only by luck, and only until a caller divides instead.
    expect(daysBetweenKeys("2027-03-13", "2027-03-15")).toBe(2);
    expect(daysBetweenKeys("2027-11-06", "2027-11-08")).toBe(2);
  });

  it("round-trips through addDaysToKey", () => {
    expect(addDaysToKey("2026-12-28", 4)).toBe("2027-01-01");
    expect(addDaysToKey("2027-01-01", -4)).toBe("2026-12-28");
    expect(daysBetweenKeys("2026-09-13", addDaysToKey("2026-09-13", 365))).toBe(365);
  });
});
describe("durationLabel", () => {
  it("uses the largest unit that still reads as a duration", () => {
    expect(durationLabel(1)).toBe("1 day");
    expect(durationLabel(12)).toBe("12 days");
    expect(durationLabel(21)).toBe("3 weeks");
    expect(durationLabel(90)).toBe("3 months");
    expect(durationLabel(365)).toBe("1 year");
    expect(durationLabel(730)).toBe("2 years");
  });
});
