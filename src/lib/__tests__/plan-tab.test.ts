import { describe, expect, it } from "vitest";
import {
  buildPlanTab,
  isNewerCoachPlan,
  parsePlanTab,
  planFromStore,
  type PlanPayload,
} from "../plan-tab";
import type { CellValue } from "../csv";

/**
 * The plan tab's whole job is to survive a trip between two devices that share
 * no ids, so the tests are mostly about what must NOT get through: a row that
 * parses into something pointing at nothing, or a stale plan reinstating
 * targets the client has moved past.
 */

const PLAN: PlanPayload = {
  phases: [
    {
      startsOn: "2026-09-20",
      name: "Cut",
      kind: "targets",
      calories: 3000,
      protein: 200,
      carbs: 300,
      fat: 80,
      steps: 24000,
    },
    { startsOn: "2026-09-19", name: "Off", kind: "untracked" },
  ],
  cards: [
    { name: "Upper", rotationOrder: 0, kind: "workout", exerciseNames: ["Bench Press", "Row"] },
    { name: "Lower", rotationOrder: 1, kind: "workout", exerciseNames: ["Squat"] },
    { name: "Rest", rotationOrder: 2, kind: "rest", exerciseNames: [] },
  ],
  pins: [{ date: "2026-09-22", cardName: "Upper" }],
  issuedBy: "coach",
  issuedAt: "2026-09-14T10:04:00.000Z",
};

/** Round-trips a plan and returns what came back. */
function through(plan: PlanPayload): PlanPayload | undefined {
  return parsePlanTab(buildPlanTab(plan));
}

/** The built tab as a mutable grid, for corrupting one cell at a time. */
function grid(plan: PlanPayload = PLAN): CellValue[][] {
  return buildPlanTab(plan).map((row) => [...row]);
}

function headerIndex(rows: CellValue[][], header: string): number {
  return rows[0].indexOf(header);
}

/** Finds the first row of a given Kind, so a test can corrupt exactly it. */
function rowOfKind(rows: CellValue[][], kind: string): CellValue[] {
  const kindCol = headerIndex(rows, "Kind");
  const row = rows.slice(1).find((r) => r[kindCol] === kind);
  if (!row) throw new Error(`no ${kind} row`);
  return row;
}

function setCell(rows: CellValue[][], row: CellValue[], header: string, value: CellValue): void {
  row[headerIndex(rows, header)] = value;
}

describe("round trip", () => {
  it("preserves every field", () => {
    const out = through(PLAN);
    expect(out).toBeDefined();
    // Compared as sets, since build sorts and the input is deliberately unsorted.
    expect(out!.phases).toHaveLength(2);
    expect(out!.phases.find((p) => p.startsOn === "2026-09-20")).toEqual(PLAN.phases[0]);
    expect(out!.phases.find((p) => p.startsOn === "2026-09-19")).toEqual(PLAN.phases[1]);
    expect(out!.cards).toEqual(PLAN.cards);
    expect(out!.pins).toEqual(PLAN.pins);
    expect(out!.issuedBy).toBe("coach");
    expect(out!.issuedAt).toBe(PLAN.issuedAt);
  });

  it("sorts phases by date and cards by rotation order", () => {
    const rows = grid();
    const kindCol = headerIndex(rows, "Kind");
    const dateCol = headerIndex(rows, "Date");
    const orderCol = headerIndex(rows, "Order");
    const phaseDates = rows
      .slice(1)
      .filter((r) => r[kindCol] === "phase")
      .map((r) => r[dateCol]);
    const cardOrders = rows
      .slice(1)
      .filter((r) => r[kindCol] === "card")
      .map((r) => r[orderCol]);
    expect(phaseDates).toEqual(["2026-09-19", "2026-09-20"]);
    expect(cardOrders).toEqual([0, 1, 2]);
  });

  it("round-trips a plan with no phases, cards or pins", () => {
    const empty: PlanPayload = { ...PLAN, phases: [], cards: [], pins: [] };
    expect(through(empty)).toEqual(empty);
  });

  it("round-trips a card with no exercises as an empty list, not one blank name", () => {
    const out = through(PLAN);
    expect(out!.cards.find((c) => c.name === "Rest")!.exerciseNames).toEqual([]);
  });

  it("keeps a zero target, which is a value rather than a blank", () => {
    const plan: PlanPayload = {
      ...PLAN,
      phases: [{ startsOn: "2026-09-20", name: "Rest week", kind: "targets", steps: 0 }],
    };
    expect(through(plan)!.phases[0].steps).toBe(0);
  });

  it("survives exercise names containing spaces and punctuation", () => {
    const plan: PlanPayload = {
      ...PLAN,
      cards: [
        {
          name: "Push",
          rotationOrder: 0,
          kind: "workout",
          exerciseNames: ["Incline DB Press", "Cable Fly (low-to-high)"],
        },
      ],
      pins: [],
    };
    expect(through(plan)!.cards[0].exerciseNames).toEqual([
      "Incline DB Press",
      "Cable Fly (low-to-high)",
    ]);
  });
});

describe("refusing a malformed tab", () => {
  it("refuses a tab with no rows", () => {
    expect(parsePlanTab([])).toBeUndefined();
    expect(parsePlanTab(undefined)).toBeUndefined();
  });

  it("refuses a tab whose headers do not line up", () => {
    expect(
      parsePlanTab([
        ["Something", "Else"],
        ["phase", "Cut"],
      ]),
    ).toBeUndefined();
  });

  it("refuses a plan with no meta rows, which cannot be attributed or ordered", () => {
    const rows = grid();
    const kindCol = headerIndex(rows, "Kind");
    expect(parsePlanTab(rows.filter((r, i) => i === 0 || r[kindCol] !== "meta"))).toBeUndefined();
  });

  it.each([
    ["a phase with no date", "phase", "Date", undefined],
    ["a phase with a malformed date", "phase", "Date", "20th Sept"],
    ["a phase with no name", "phase", "Name", undefined],
    ["a phase with an unknown kind", "phase", "Value", "bulking"],
    ["a phase with a non-numeric target", "phase", "Calories", "about 3000"],
    ["a phase with a negative target", "phase", "Calories", -200],
    ["a card with no name", "card", "Name", undefined],
    ["a card with no order", "card", "Order", undefined],
    ["a card with a non-numeric order", "card", "Order", "first"],
    ["a card with an unknown card kind", "card", "Card Kind", "superset"],
    ["a pin with no date", "pin", "Date", undefined],
    ["a pin with a malformed date", "pin", "Date", "tuesday"],
    ["a pin naming no card", "pin", "Name", undefined],
    ["a pin naming a card that is not in the plan", "pin", "Name", "Conditioning"],
    ["an unknown issuedBy", "meta", "Value", "somebody-else"],
  ])("refuses %s", (_label, kind, header, value) => {
    const rows = grid();
    setCell(rows, rowOfKind(rows, kind), header, value);
    expect(parsePlanTab(rows)).toBeUndefined();
  });

  it("refuses two phases starting on the same day", () => {
    const plan: PlanPayload = {
      ...PLAN,
      phases: [
        { startsOn: "2026-09-20", name: "Cut", kind: "targets" },
        { startsOn: "2026-09-20", name: "Bulk", kind: "targets" },
      ],
      pins: [],
    };
    expect(parsePlanTab(buildPlanTab(plan))).toBeUndefined();
  });

  it("refuses two cards sharing a name, since the name is the identity", () => {
    const plan: PlanPayload = {
      ...PLAN,
      cards: [
        { name: "Upper", rotationOrder: 0, kind: "workout", exerciseNames: [] },
        { name: "upper", rotationOrder: 1, kind: "workout", exerciseNames: [] },
      ],
      pins: [],
    };
    expect(parsePlanTab(buildPlanTab(plan))).toBeUndefined();
  });

  it("refuses two pins on one day", () => {
    const rows = grid();
    const pin = rowOfKind(rows, "pin");
    rows.push([...pin]);
    expect(parsePlanTab(rows)).toBeUndefined();
  });

  it("refuses an unparseable issuedAt", () => {
    const rows = grid();
    const kindCol = headerIndex(rows, "Kind");
    const nameCol = headerIndex(rows, "Name");
    const row = rows.slice(1).find((r) => r[kindCol] === "meta" && r[nameCol] === "issuedAt")!;
    setCell(rows, row, "Value", "last tuesday");
    expect(parsePlanTab(rows)).toBeUndefined();
  });
});

describe("tolerating the ordinary", () => {
  it("skips a row whose kind it does not recognise, for forward compatibility", () => {
    const rows = grid();
    const row = rows[0].map(() => undefined as CellValue);
    row[headerIndex(rows, "Kind")] = "deload-protocol";
    row[headerIndex(rows, "Name")] = "something a later version added";
    rows.push(row);
    expect(parsePlanTab(rows)).toEqual(through(PLAN));
  });

  it("skips blank spacer rows", () => {
    const rows = grid();
    rows.splice(
      2,
      0,
      rows[0].map(() => undefined as CellValue),
    );
    expect(parsePlanTab(rows)).toEqual(through(PLAN));
  });

  it("reads columns by name, so an inserted column changes nothing", () => {
    const rows = grid();
    // Someone adds a notes column in the middle, as people do to spreadsheets.
    const withNotes = rows.map((row, i) => {
      const copy = [...row];
      copy.splice(2, 0, i === 0 ? "My notes" : "looks hard");
      return copy;
    });
    expect(parsePlanTab(withNotes)).toEqual(through(PLAN));
  });

  it("reads the Kind column case-insensitively", () => {
    const rows = grid();
    setCell(rows, rowOfKind(rows, "card"), "Kind", "CARD");
    expect(parsePlanTab(rows)).toEqual(through(PLAN));
  });
});

describe("planFromStore", () => {
  const source = {
    exercises: [
      { id: "e1", name: "Bench Press", type: "main" as const },
      { id: "e2", name: "Row", type: "main" as const },
    ],
    slots: [
      { id: "s1", name: "Upper", rotationOrder: 0, plannedExerciseIds: ["e1", "e2"] },
      { id: "s2", name: "Rest", rotationOrder: 1, kind: "rest" as const },
    ],
    nutritionPhases: [
      { id: "p1", startsOn: "2026-09-20", name: "Cut", kind: "targets" as const, calories: 3000 },
    ],
    plannedDays: [{ date: "2026-09-22", splitSlotId: "s1" }],
  };
  const issued = { by: "client" as const, at: "2026-09-14T10:00:00.000Z" };

  it("carries exercises as names and no ids at all", () => {
    const plan = planFromStore(source, issued);
    expect(plan.cards[0].exerciseNames).toEqual(["Bench Press", "Row"]);
    expect(JSON.stringify(plan)).not.toContain("e1");
    expect(JSON.stringify(plan)).not.toContain("s1");
    expect(JSON.stringify(plan)).not.toContain("p1");
  });

  it("names the card a pin points at", () => {
    expect(planFromStore(source, issued).pins).toEqual([{ date: "2026-09-22", cardName: "Upper" }]);
  });

  it("defaults a card with no kind to workout", () => {
    expect(planFromStore(source, issued).cards[0].kind).toBe("workout");
  });

  it("drops a pin whose slot no longer exists rather than writing a dangling one", () => {
    const orphaned = { ...source, plannedDays: [{ date: "2026-09-23", splitSlotId: "gone" }] };
    expect(planFromStore(orphaned, issued).pins).toEqual([]);
  });

  it("drops an exercise id that matches no record", () => {
    const orphaned = {
      ...source,
      slots: [{ id: "s1", name: "Upper", rotationOrder: 0, plannedExerciseIds: ["e1", "gone"] }],
      plannedDays: [],
    };
    expect(planFromStore(orphaned, issued).cards[0].exerciseNames).toEqual(["Bench Press"]);
  });

  it("produces a payload the tab round-trips", () => {
    const plan = planFromStore(source, issued);
    expect(parsePlanTab(buildPlanTab(plan))).toEqual(plan);
  });
});

describe("isNewerCoachPlan", () => {
  const coach = (at: string): PlanPayload => ({ ...PLAN, issuedBy: "coach", issuedAt: at });

  it("accepts a coach plan when nothing has been accepted yet", () => {
    expect(isNewerCoachPlan(coach("2026-09-14T10:00:00Z"), undefined)).toBe(true);
  });

  it("accepts a coach plan issued after the last accepted one", () => {
    expect(isNewerCoachPlan(coach("2026-09-14T11:00:00Z"), "2026-09-14T10:00:00Z")).toBe(true);
  });

  it("refuses a plan issued before the last accepted one", () => {
    // The stale-link case: an old message tapped a month late.
    expect(isNewerCoachPlan(coach("2026-08-01T10:00:00Z"), "2026-09-14T10:00:00Z")).toBe(false);
  });

  it("refuses a plan issued at exactly the last accepted instant", () => {
    // Re-reading the same tab on every sync must be idempotent.
    expect(isNewerCoachPlan(coach("2026-09-14T10:00:00Z"), "2026-09-14T10:00:00Z")).toBe(false);
  });

  it("never offers a client's own plan back to them", () => {
    const own: PlanPayload = { ...PLAN, issuedBy: "client", issuedAt: "2030-01-01T00:00:00Z" };
    expect(isNewerCoachPlan(own, undefined)).toBe(false);
  });

  it("refuses a candidate whose issuedAt is unparseable", () => {
    expect(isNewerCoachPlan(coach("whenever"), "2026-09-14T10:00:00Z")).toBe(false);
  });
});
