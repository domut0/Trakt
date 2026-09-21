import { describe, expect, it } from "vitest";
import {
  advanceSplit,
  closeOpenPhases,
  convertSplit,
  firstDayCard,
  isNutritionPhase,
  isPlannedDay,
  phaseForDate,
  phasesOverlap,
  pinnedSlotIdFor,
  sortPhases,
  type NutritionPhase,
} from "../planning";

/** The user's own stated case: maintenance for a week, then a cut that is still
 *  running. The gap between them is deliberate - there is a Saturday in the
 *  middle that belongs to no phase at all, which the old model could not say. */
const MAINTENANCE: NutritionPhase = {
  id: "p_maint",
  startsOn: "2026-09-13",
  endsOn: "2026-09-18",
  name: "Maintenance",
  calories: 3400,
  steps: 20000,
};
const CUT: NutritionPhase = {
  id: "p_cut",
  startsOn: "2026-09-20",
  name: "Cut",
  calories: 3000,
  steps: 24000,
};
const PHASES = [CUT, MAINTENANCE]; // deliberately unsorted

describe("phaseForDate", () => {
  it("resolves the timeline a day at a time", () => {
    expect(phaseForDate(PHASES, "2026-09-13")?.id).toBe("p_maint"); // first day
    expect(phaseForDate(PHASES, "2026-09-16")?.id).toBe("p_maint"); // mid-phase
    expect(phaseForDate(PHASES, "2026-09-18")?.id).toBe("p_maint"); // last day, inclusive
    expect(phaseForDate(PHASES, "2026-09-20")?.id).toBe("p_cut");
    expect(phaseForDate(PHASES, "2027-06-01")?.id).toBe("p_cut"); // open end runs on
  });

  it("is undefined in a gap, which is the whole reason for end dates", () => {
    // The Saturday between the two phases. Under the old model this was
    // impossible to express: maintenance would have run right up to the cut,
    // and the app would have claimed a target for a day that had none.
    expect(phaseForDate(PHASES, "2026-09-19")).toBeUndefined();
  });

  it("is undefined before the first phase, which is a real state", () => {
    // History logged before any plan existed. Not an error, and not a reason to
    // invent a default that would claim the user was aiming at something.
    expect(phaseForDate(PHASES, "2026-09-12")).toBeUndefined();
  });

  it("is undefined after the last phase ends", () => {
    const ended = [{ ...CUT, endsOn: "2026-12-31" }];
    expect(phaseForDate(ended, "2026-12-31")?.id).toBe("p_cut");
    expect(phaseForDate(ended, "2027-01-01")).toBeUndefined();
  });

  it("does not depend on input order", () => {
    expect(phaseForDate([...PHASES].reverse(), "2026-09-16")?.id).toBe("p_maint");
  });

  it("returns nothing from an empty timeline", () => {
    expect(phaseForDate([], "2026-09-13")).toBeUndefined();
  });
});

describe("phasesOverlap", () => {
  const range = (id: string, startsOn: string, endsOn?: string): NutritionPhase => ({
    id,
    startsOn,
    endsOn,
    name: id,
  });

  it("is false for ranges that merely touch end to start", () => {
    // The ordinary case, and the one that must not be refused: a phase ending
    // on the 18th and the next starting on the 19th share no day.
    expect(phasesOverlap(range("a", "2026-09-13", "2026-09-18"), range("b", "2026-09-19"))).toBe(
      false,
    );
  });

  it("is true when they share a single day", () => {
    expect(phasesOverlap(range("a", "2026-09-13", "2026-09-19"), range("b", "2026-09-19"))).toBe(
      true,
    );
  });

  it("is true when one contains the other", () => {
    expect(
      phasesOverlap(range("a", "2026-09-01", "2026-12-31"), range("b", "2026-10-01", "2026-10-07")),
    ).toBe(true);
  });

  it("treats an open end as running forever", () => {
    expect(phasesOverlap(range("a", "2026-09-13"), range("b", "2030-01-01", "2030-02-01"))).toBe(
      true,
    );
  });
});

describe("closeOpenPhases", () => {
  it("derives the ends the old change-point model implied", () => {
    // Exactly what is in IndexedDB for anyone who used the app before end dates
    // existed: three starts and nothing else.
    const legacy: NutritionPhase[] = [
      { id: "a", startsOn: "2026-09-13", name: "Maintenance" },
      { id: "b", startsOn: "2026-09-19", name: "Off" },
      { id: "c", startsOn: "2026-09-20", name: "Cut" },
    ];
    const closed = closeOpenPhases(legacy);
    expect(closed.map((p) => [p.startsOn, p.endsOn])).toEqual([
      ["2026-09-13", "2026-09-18"],
      ["2026-09-19", "2026-09-19"],
      // The most recent phase keeps running, which is what it was doing.
      ["2026-09-20", undefined],
    ]);
  });

  it("resolves identically to the old model, day for day", () => {
    const legacy: NutritionPhase[] = [
      { id: "a", startsOn: "2026-09-13", name: "Maintenance" },
      { id: "b", startsOn: "2026-09-19", name: "Off" },
      { id: "c", startsOn: "2026-09-20", name: "Cut" },
    ];
    // The migration's real claim: nobody's plan changes meaning under it.
    const closed = closeOpenPhases(legacy);
    for (const [date, id] of [
      ["2026-09-13", "a"],
      ["2026-09-18", "a"],
      ["2026-09-19", "b"],
      ["2026-09-20", "c"],
      ["2027-06-01", "c"],
    ] as const) {
      expect(phaseForDate(closed, date)?.id, date).toBe(id);
    }
  });

  it("leaves an end that is already there alone, and runs clean twice", () => {
    const once = closeOpenPhases(PHASES);
    expect(closeOpenPhases(once)).toEqual(once);
    expect(once.find((p) => p.id === "p_maint")?.endsOn).toBe("2026-09-18");
    expect(once.find((p) => p.id === "p_cut")?.endsOn).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const input: NutritionPhase[] = [
      { id: "a", startsOn: "2026-09-13", name: "A" },
      { id: "b", startsOn: "2026-09-20", name: "B" },
    ];
    closeOpenPhases(input);
    expect(input[0].endsOn).toBeUndefined();
  });
});

describe("sortPhases", () => {
  it("orders by start date, oldest first", () => {
    expect(sortPhases(PHASES).map((p) => p.id)).toEqual(["p_maint", "p_cut"]);
  });

  it("does not mutate its input", () => {
    const input = [...PHASES];
    sortPhases(input);
    expect(input.map((p) => p.id)).toEqual(["p_cut", "p_maint"]);
  });
});

describe("pinnedSlotIdFor", () => {
  const pins = [
    { date: "2026-09-19", splitSlotId: "s_lower" },
    { date: "2026-09-21", splitSlotId: "s_upper" },
  ];

  it("finds a pin and nothing else", () => {
    expect(pinnedSlotIdFor(pins, "2026-09-19")).toBe("s_lower");
    // Never inferred: an unpinned day has no answer, rather than the rotation's
    // guess dressed up as a plan.
    expect(pinnedSlotIdFor(pins, "2026-09-20")).toBeUndefined();
  });
});

describe("backup tolerance", () => {
  it("accepts a well-formed phase", () => {
    expect(isNutritionPhase(MAINTENANCE)).toBe(true);
    // Open-ended, which is the normal state of the phase you are in.
    expect(isNutritionPhase(CUT)).toBe(true);
    expect(isNutritionPhase({ ...CUT, note: "keep protein up on rest days" })).toBe(true);
  });

  it("rejects rows that would poison the timeline", () => {
    expect(isNutritionPhase({ ...MAINTENANCE, startsOn: "13/09/2026" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, startsOn: "2026-9-3" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, endsOn: "18/09/2026" })).toBe(false);
    // An end before its own start is not a phase, it is a typo that would make
    // the row cover nothing at all.
    expect(isNutritionPhase({ ...MAINTENANCE, endsOn: "2026-09-01" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, note: 7 })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, id: "" })).toBe(false);
    expect(isNutritionPhase({ ...MAINTENANCE, calories: "3400" })).toBe(false);
    expect(isNutritionPhase(null)).toBe(false);
  });

  it("accepts and rejects pins on the same terms", () => {
    expect(isPlannedDay({ date: "2026-09-19", splitSlotId: "s1" })).toBe(true);
    expect(isPlannedDay({ date: "2026-09-19", splitSlotId: "" })).toBe(false);
    expect(isPlannedDay({ date: "nope", splitSlotId: "s1" })).toBe(false);
  });
});

describe("advanceSplit: the user's UL-forever split", () => {
  /** Upper, Lower, Repeat, Rest, Repeat - exactly the five cards the user
   *  described, in that order. */
  const UL = [
    { id: "c_upper", rotationOrder: 0 },
    { id: "c_lower", rotationOrder: 1 },
    { id: "c_rep1", rotationOrder: 2, kind: "repeat" as const },
    { id: "c_rest", rotationOrder: 3, kind: "rest" as const },
    { id: "c_rep2", rotationOrder: 4, kind: "repeat" as const },
  ];

  it("alternates upper and lower forever, never reaching rest", () => {
    // The claim the whole design rests on. Advancing off Lower lands on a
    // repeat, which bounces to the top, so Rest is unreachable by advancing.
    let card = firstDayCard(UL)!;
    const walked: string[] = [card.id];
    for (let i = 0; i < 7; i++) {
      card = advanceSplit(UL, card.id)!;
      walked.push(card.id);
    }
    expect(walked).toEqual([
      "c_upper",
      "c_lower",
      "c_upper",
      "c_lower",
      "c_upper",
      "c_lower",
      "c_upper",
      "c_lower",
    ]);
    expect(walked).not.toContain("c_rest");
    expect(walked).not.toContain("c_rep1");
  });

  it("returns to upper the day after a rest was taken", () => {
    // Rest is chosen deliberately, never landed on. Consuming it hits the
    // SECOND repeat, which bounces to the top the same way the first does.
    expect(advanceSplit(UL, "c_rest")?.id).toBe("c_upper");
  });

  it("never offers a repeat as a day", () => {
    for (const c of UL) {
      expect(advanceSplit(UL, c.id)?.kind).not.toBe("repeat");
    }
  });
});

describe("advanceSplit: edges", () => {
  it("starts at the first day card with no cursor", () => {
    const cards = [
      { id: "a", rotationOrder: 0 },
      { id: "b", rotationOrder: 1 },
    ];
    expect(advanceSplit(cards, undefined)?.id).toBe("a");
    expect(firstDayCard(cards)?.id).toBe("a");
  });

  it("skips a leading repeat rather than sitting on it", () => {
    // "Go back to the top" is meaningless when the top IS the repeat, so the
    // walk steps forward instead of bouncing in place.
    const cards = [
      { id: "r", rotationOrder: 0, kind: "repeat" as const },
      { id: "a", rotationOrder: 1 },
    ];
    expect(firstDayCard(cards)?.id).toBe("a");
    expect(advanceSplit(cards, "a")?.id).toBe("a");
  });

  it("wraps a split with no repeats at all", () => {
    const cards = [
      { id: "a", rotationOrder: 0 },
      { id: "b", rotationOrder: 1 },
    ];
    expect(advanceSplit(cards, "b")?.id).toBe("a");
  });

  it("gives up rather than hanging on a split of only repeats", () => {
    // Reachable by deleting every named card, and a loop here would be a frozen
    // screen rather than an empty one.
    const cards = [
      { id: "r1", rotationOrder: 0, kind: "repeat" as const },
      { id: "r2", rotationOrder: 1, kind: "repeat" as const },
    ];
    expect(advanceSplit(cards, "r1")).toBeUndefined();
    expect(firstDayCard(cards)).toBeUndefined();
  });

  it("is empty for an empty split, and recovers from an unknown cursor", () => {
    expect(advanceSplit([], undefined)).toBeUndefined();
    const cards = [{ id: "a", rotationOrder: 0 }];
    // A cursor pointing at a deleted card falls back to the start rather than
    // leaving the split stuck with no next.
    expect(advanceSplit(cards, "gone")?.id).toBe("a");
  });

  it("reads order from rotationOrder, not array position", () => {
    const cards = [
      { id: "b", rotationOrder: 1 },
      { id: "a", rotationOrder: 0 },
    ];
    expect(advanceSplit(cards, "a")?.id).toBe("b");
  });
});

describe("convertSplit", () => {
  /** The user's own split: Upper, Lower, Repeat, Rest, Repeat. */
  const cycle = [
    { id: "upper", rotationOrder: 0 },
    { id: "lower", rotationOrder: 1 },
    { id: "rep1", rotationOrder: 2, kind: "repeat" as const },
    { id: "rest", rotationOrder: 3, kind: "rest" as const },
    { id: "rep2", rotationOrder: 4, kind: "repeat" as const },
  ];

  it("lays the day cards out from Monday and leaves the repeats off the week", () => {
    const week = convertSplit(cycle, "week");

    expect(week.find((c) => c.id === "upper")?.weekday).toBe(1);
    expect(week.find((c) => c.id === "lower")?.weekday).toBe(2);
    expect(week.find((c) => c.id === "rest")?.weekday).toBe(3);
    expect(week.find((c) => c.id === "rep1")?.weekday).toBeUndefined();
  });

  it("carries the repeats through rather than deleting them", () => {
    const week = convertSplit(cycle, "week");
    expect(week.filter((c) => c.kind === "repeat")).toHaveLength(2);
  });

  it("returns every repeat to the card it followed, however the week moved them", () => {
    // Rest to Monday, Upper to Wednesday: the two ends of the cycle swap.
    const week = convertSplit(cycle, "week").map((c) =>
      c.id === "rest" ? { ...c, weekday: 1 } : c.id === "upper" ? { ...c, weekday: 3 } : c,
    );

    const back = convertSplit(week, "rotation");

    // Rest leads now, and rep2 - which sat behind Rest - leads with it.
    expect(back.map((c) => c.id)).toEqual(["rest", "rep2", "lower", "rep1", "upper"]);
    expect(back.every((c) => c.weekday === undefined)).toBe(true);
    expect(back.map((c) => c.rotationOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("reads a week back from Monday, not from Sunday", () => {
    // Sunday is 0 in JavaScript, so a naive sort puts it in front of Monday -
    // and the planner that wrote this week starts on Monday.
    const week = [
      { id: "sun", rotationOrder: 0, weekday: 0 },
      { id: "mon", rotationOrder: 1, weekday: 1 },
    ];

    expect(convertSplit(week, "rotation").map((c) => c.id)).toEqual(["mon", "sun"]);
  });

  it("survives a round trip with nothing rearranged", () => {
    const back = convertSplit(convertSplit(cycle, "week"), "rotation");
    expect(back.map((c) => c.id)).toEqual(["upper", "lower", "rep1", "rest", "rep2"]);
  });
});
