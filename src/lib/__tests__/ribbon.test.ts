import { describe, expect, it } from "vitest";
import { RIBBON, layoutRibbon, ribbonWidth, ribbonX, type NutritionPhase } from "../planning";

/**
 * The ribbon's geometry.
 *
 * Worth pinning hard because it is the one place in the app where a drawing
 * makes a claim about a quantity: the width of a segment says how long a
 * stretch of time is. Where that claim cannot be kept - a year-long bulk beside
 * a twelve-day deload - the rule is that the drawing must SAY it is broken
 * rather than quietly compress. `capped` is that flag.
 *
 * The gap segments are the new half. The old ribbon could not have one: phases
 * ran until the next began, so the timeline was continuous by construction.
 */

function phase(startsOn: string, endsOn?: string, name = startsOn): NutritionPhase {
  return { id: `p_${startsOn}`, startsOn, endsOn, name };
}

describe("layoutRibbon", () => {
  it("draws a short phase at true scale", () => {
    // 14 days inclusive at 4.5px/day is 63px, inside the floor and the ceiling.
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-26")]);
    expect(segs).toHaveLength(1);
    expect(segs[0].days).toBe(14);
    expect(segs[0].width).toBe(63);
    expect(segs[0].capped).toBe(false);
  });

  it("counts an inclusive end, so a one-day phase is one day", () => {
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-13")]);
    expect(segs[0].days).toBe(1);
  });

  it("floors a one-day phase so it stays readable and tappable", () => {
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-13")]);
    expect(segs[0].width).toBe(RIBBON.MIN_W);
    // Not capped: the floor makes it BIGGER than true scale, which overstates
    // nothing about a duration anybody could misread.
    expect(segs[0].capped).toBe(false);
  });

  it("caps a year-long phase and marks the break", () => {
    const segs = layoutRibbon([phase("2026-01-01", "2026-12-31")]);
    expect(segs[0].width).toBe(RIBBON.MAX_W);
    expect(segs[0].capped).toBe(true);
    expect(segs[0].days).toBe(365);
  });

  it("gives an open-ended phase a tail rather than a length", () => {
    const segs = layoutRibbon([phase("2026-09-13")]);
    expect(segs[0].open).toBe(true);
    expect(segs[0].days).toBeUndefined();
    expect(segs[0].width).toBe(RIBBON.TAIL_W);
    expect(segs[0].capped).toBe(false);
  });

  it("draws a gap between two phases that do not touch", () => {
    // Maintenance ends the 18th, the cut starts the 20th. The 19th belongs to
    // nobody, and the ribbon has to say so rather than butting them together.
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-18"), phase("2026-09-20")]);
    expect(segs).toHaveLength(3);
    expect(segs[0].phase?.id).toBe("p_2026-09-13");
    expect(segs[1].phase).toBeUndefined();
    expect(segs[1].days).toBe(1);
    expect(segs[2].phase?.id).toBe("p_2026-09-20");
  });

  it("draws no gap between phases that touch end to start", () => {
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-19"), phase("2026-09-20")]);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.phase !== undefined)).toBe(true);
  });

  it("measures a gap at true scale, and caps it like anything else", () => {
    const segs = layoutRibbon([phase("2026-01-01", "2026-01-31"), phase("2026-12-01")]);
    const gap = segs[1];
    expect(gap.phase).toBeUndefined();
    expect(gap.days).toBe(303);
    expect(gap.width).toBe(RIBBON.MAX_W);
    expect(gap.capped).toBe(true);
  });

  it("cannot put a gap after an open-ended phase", () => {
    // An open phase covers every day after it, so there is nothing for a gap to
    // be. (The store refuses this arrangement; the layout must not invent one.)
    const segs = layoutRibbon([phase("2026-09-13"), phase("2027-01-01")]);
    expect(segs.filter((s) => s.phase === undefined)).toHaveLength(0);
  });

  it("lays segments end to end, in date order, whatever order they arrive in", () => {
    const segs = layoutRibbon([phase("2026-09-20"), phase("2026-09-13", "2026-09-18")]);
    expect(segs[0].x).toBe(0);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].x).toBe(segs[i - 1].x + segs[i - 1].width);
    }
    expect(segs[0].phase?.id).toBe("p_2026-09-13");
  });

  it("is empty for an empty plan", () => {
    expect(layoutRibbon([])).toEqual([]);
    expect(ribbonWidth([])).toBe(0);
  });
});

describe("ribbonX", () => {
  it("places a date proportionally inside its segment", () => {
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-26")]);
    // Seven days into a 14 day segment drawn 63px wide.
    expect(ribbonX(segs, "2026-09-20")).toBeCloseTo(31.5, 5);
  });

  it("stays inside a capped segment rather than running off its end", () => {
    const segs = layoutRibbon([phase("2026-01-01", "2026-12-31")]);
    const x = ribbonX(segs, "2026-12-30");
    expect(x).toBeLessThanOrEqual(segs[0].x + segs[0].width);
  });

  it("returns undefined before the plan starts", () => {
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-26")]);
    expect(ribbonX(segs, "2026-09-12")).toBeUndefined();
  });

  it("locates a date inside a gap against the segment before it", () => {
    const segs = layoutRibbon([phase("2026-09-13", "2026-09-18"), phase("2026-09-25")]);
    const x = ribbonX(segs, "2026-09-21");
    // Somewhere on the ribbon, and never before the phase that precedes it.
    expect(x).toBeDefined();
    expect(x!).toBeGreaterThanOrEqual(segs[0].x);
  });
});
