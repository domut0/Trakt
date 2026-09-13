import { describe, expect, it } from "vitest";
import {
  RIBBON,
  addDaysToKey,
  daysBetweenKeys,
  durationLabel,
  layoutRibbon,
  ribbonWidth,
  ribbonX,
  type NutritionPhase,
} from "../planning";

/**
 * The ribbon's geometry.
 *
 * Worth pinning hard because it is the one place in the app where a drawing
 * makes a claim about a quantity: the width of a segment says how long a phase
 * is. Where that claim cannot be kept - a year-long bulk beside a twelve-day
 * maintenance block - the rule is that the drawing must SAY it is broken rather
 * than quietly compress. `capped` is that flag, and the tests below are mostly
 * about when it is set.
 */

function phase(startsOn: string, name = startsOn): NutritionPhase {
  return { id: `p_${startsOn}`, startsOn, name, kind: "targets" };
}

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

describe("layoutRibbon", () => {
  it("draws a short phase at true scale", () => {
    const segs = layoutRibbon([phase("2026-09-13"), phase("2026-09-27")]);
    expect(segs[0].days).toBe(14);
    expect(segs[0].width).toBe(14 * RIBBON.PX_PER_DAY);
    expect(segs[0].capped).toBe(false);
  });

  it("floors a one-day phase so it stays grabbable", () => {
    // The user's untracked Saturday. At true scale it would be 4.5px wide,
    // which is neither readable nor something a thumb can land on.
    const segs = layoutRibbon([
      phase("2026-09-13"),
      phase("2026-09-19", "Off"),
      phase("2026-09-20"),
    ]);
    expect(segs[1].days).toBe(1);
    expect(segs[1].width).toBe(RIBBON.MIN_W);
    // A floored phase is drawn LONGER than it is, which needs no break mark:
    // the mark exists to stop the eye reading a width as a duration, and
    // nobody reads 52px as one day.
    expect(segs[1].capped).toBe(false);
  });

  it("caps a year-long phase and marks the break", () => {
    const segs = layoutRibbon([
      phase("2027-01-01", "Bulk"),
      phase("2028-01-01", "Cut"),
      phase("2028-02-01"),
    ]);
    expect(segs[0].days).toBe(365);
    expect(segs[0].width).toBe(RIBBON.MAX_W);
    expect(segs[0].capped).toBe(true);
  });

  it("gives the last phase a tail rather than a length", () => {
    const segs = layoutRibbon([phase("2026-09-13"), phase("2026-09-20")]);
    const last = segs[1];
    expect(last.open).toBe(true);
    expect(last.days).toBeUndefined();
    expect(last.width).toBe(RIBBON.TAIL_W);
    // Not a break: an open-ended phase has no true width to be short of.
    expect(last.capped).toBe(false);
  });

  it("lays segments end to end, in date order, whatever order they arrive in", () => {
    const segs = layoutRibbon([phase("2026-10-01", "b"), phase("2026-09-13", "a")]);
    expect(segs.map((s) => s.phase.name)).toEqual(["a", "b"]);
    expect(segs[0].x).toBe(0);
    expect(segs[1].x).toBe(segs[0].width);
    expect(ribbonWidth(segs)).toBe(segs[0].width + segs[1].width);
  });

  it("is empty for an empty plan", () => {
    expect(layoutRibbon([])).toEqual([]);
    expect(ribbonWidth([])).toBe(0);
  });
});

describe("ribbonX", () => {
  it("places a date proportionally inside its segment", () => {
    const segs = layoutRibbon([phase("2026-09-13"), phase("2026-09-27")]);
    expect(ribbonX(segs, "2026-09-13")).toBe(0);
    expect(ribbonX(segs, "2026-09-20")).toBe(7 * RIBBON.PX_PER_DAY);
  });

  it("stays inside a capped segment rather than running off its end", () => {
    // The honest limit of a broken scale: inside a segment drawn shorter than
    // it is, a date can only be placed approximately, so it is clamped.
    const segs = layoutRibbon([phase("2027-01-01"), phase("2028-01-01")]);
    const x = ribbonX(segs, "2027-12-25")!;
    expect(x).toBeLessThanOrEqual(segs[0].width);
    expect(x).toBeGreaterThan(0);
  });

  it("returns undefined before the plan starts", () => {
    const segs = layoutRibbon([phase("2026-09-13")]);
    expect(ribbonX(segs, "2026-09-12")).toBeUndefined();
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
