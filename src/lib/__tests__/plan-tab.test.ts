import { describe, expect, it } from "vitest";
import {
  buildPlanTab,
  diffPlan,
  isNewerCoachPlan,
  parsePlanTab,
  planFromStore,
  formatLift,
  parseLift,
  PLAN_FORMAT_VERSION,
  resolvePlan,
  type PlanLift,
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

      calories: 3000,
      protein: 200,
      carbs: 300,
      fat: 80,
      steps: 24000,
    },
    { startsOn: "2026-09-19", name: "Off" },
  ],
  cards: [
    {
      name: "Upper",
      rotationOrder: 0,
      kind: "workout",
      lifts: [{ name: "Bench Press" }, { name: "Row" }],
    },
    { name: "Lower", rotationOrder: 1, kind: "workout", lifts: [{ name: "Squat" }] },
    { name: "Rest", rotationOrder: 2, kind: "rest", lifts: [] },
  ],
  pins: [{ date: "2026-09-22", cardName: "Upper" }],
  mode: "rotation",
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
    expect(out!.cards.find((c) => c.name === "Rest")!.lifts).toEqual([]);
  });

  it("keeps a zero target, which is a value rather than a blank", () => {
    const plan: PlanPayload = {
      ...PLAN,
      phases: [{ startsOn: "2026-09-20", name: "Rest week", steps: 0 }],
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
          lifts: [{ name: "Incline DB Press" }, { name: "Cable Fly (low-to-high)" }],
        },
      ],
      pins: [],
    };
    expect(through(plan)!.cards[0].lifts.map((l) => l.name)).toEqual([
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
    ["a phase whose end is malformed", "phase", "End", "20th Sept"],
    ["a phase that ends before it starts", "phase", "End", "2020-01-01"],
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
        { startsOn: "2026-09-20", name: "Cut" },
        { startsOn: "2026-09-20", name: "Bulk" },
      ],
      pins: [],
    };
    expect(parsePlanTab(buildPlanTab(plan))).toBeUndefined();
  });

  it("refuses two cards sharing a name, since the name is the identity", () => {
    const plan: PlanPayload = {
      ...PLAN,
      cards: [
        { name: "Upper", rotationOrder: 0, kind: "workout", lifts: [] },
        { name: "upper", rotationOrder: 1, kind: "workout", lifts: [] },
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
      {
        id: "s1",
        name: "Upper",
        rotationOrder: 0,
        plannedLifts: [{ exerciseId: "e1" }, { exerciseId: "e2" }],
      },
      { id: "s2", name: "Rest", rotationOrder: 1, kind: "rest" as const },
    ],
    nutritionPhases: [{ id: "p1", startsOn: "2026-09-20", name: "Cut" as const, calories: 3000 }],
    plannedDays: [{ date: "2026-09-22", splitSlotId: "s1" }],
    planningMode: "rotation" as const,
  };
  const issued = { by: "client" as const, at: "2026-09-14T10:00:00.000Z" };

  it("carries exercises as names and no ids at all", () => {
    const plan = planFromStore(source, issued);
    expect(plan.cards[0].lifts.map((l) => l.name)).toEqual(["Bench Press", "Row"]);
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
      slots: [
        {
          id: "s1",
          name: "Upper",
          rotationOrder: 0,
          plannedLifts: [{ exerciseId: "e1" }, { exerciseId: "gone" }],
        },
      ],
      plannedDays: [],
    };
    expect(planFromStore(orphaned, issued).cards[0].lifts.map((l) => l.name)).toEqual([
      "Bench Press",
    ]);
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

describe("resolvePlan", () => {
  /** Deterministic ids, so assertions can name them. */
  function ids() {
    let n = 0;
    return () => `new${++n}`;
  }

  const target = {
    slots: [
      { id: "s_upper", name: "Upper", rotationOrder: 0, plannedLifts: [{ exerciseId: "e_bench" }] },
      { id: "s_lower", name: "Lower", rotationOrder: 1, lastLoggedAt: 1_700_000_000_000 },
      { id: "s_legs", name: "Legs", rotationOrder: 2 },
    ],
    exercises: [
      { id: "e_bench", name: "Bench Press", type: "main" as const },
      { id: "e_squat", name: "Back Squat", type: "main" as const },
    ],
    nutritionPhases: [
      {
        id: "p_cut",
        startsOn: "2026-09-20",
        name: "Cut",

        calories: 2800,
      },
    ],
  };

  const plan: PlanPayload = {
    phases: [
      { startsOn: "2026-09-20", name: "Cut", calories: 2400, protein: 210 },
      { startsOn: "2026-10-01", name: "Maintain", calories: 3000 },
    ],
    cards: [
      {
        name: "upper",
        rotationOrder: 0,
        kind: "workout",
        lifts: [{ name: "Bench Press" }, { name: "Pendlay Row" }],
      },
      { name: "Lower", rotationOrder: 1, kind: "workout", lifts: [{ name: "Back Squat" }] },
    ],
    pins: [{ date: "2026-09-22", cardName: "Upper" }],
    mode: "rotation",
    issuedBy: "coach",
    issuedAt: "2026-09-14T10:00:00.000Z",
  };

  it("keeps an existing slot's id when the name matches, ignoring case", () => {
    // The whole reason cards match by name: every WorkoutSession pointing at
    // s_upper must still point at it after the plan is accepted.
    const out = resolvePlan(plan, target, ids());
    expect(out.slots.find((s) => s.name === "upper")!.id).toBe("s_upper");
  });

  it("keeps where the client is in the split", () => {
    const out = resolvePlan(plan, target, ids());
    expect(out.slots.find((s) => s.name === "Lower")!.lastLoggedAt).toBe(1_700_000_000_000);
  });

  it("mints an id for a card the device has never had", () => {
    const withNew: PlanPayload = {
      ...plan,
      cards: [...plan.cards, { name: "Push", rotationOrder: 2, kind: "workout", lifts: [] }],
    };
    const out = resolvePlan(withNew, target, ids());
    // A minted id, not one of the device's existing ones. Which number it gets
    // depends on how many exercises were created first, which is not a
    // guarantee this function makes.
    const push = out.slots.find((s) => s.name === "Push")!;
    expect(push.id).toMatch(/^new\d+$/);
    expect(target.slots.map((s) => s.id)).not.toContain(push.id);
  });

  it("resolves a known exercise to its existing id and creates nothing", () => {
    const out = resolvePlan(plan, target, ids());
    const lower = out.slots.find((s) => s.name === "Lower")!;
    expect(lower.plannedLifts?.map((l) => l.exerciseId)).toEqual(["e_squat"]);
  });

  it("creates an exercise the device has never heard of, as an accessory", () => {
    const out = resolvePlan(plan, target, ids());
    expect(out.createdExercises).toHaveLength(1);
    expect(out.createdExercises[0].name).toBe("Pendlay Row");
    // cardio is the only type the app branches on, so nothing becomes cardio
    // because a name arrived in a plan.
    expect(out.createdExercises[0].type).toBe("accessory");
  });

  it("creates one record for a name used on two cards", () => {
    const twice: PlanPayload = {
      ...plan,
      cards: [
        { name: "A", rotationOrder: 0, kind: "workout", lifts: [{ name: "Face Pull" }] },
        { name: "B", rotationOrder: 1, kind: "workout", lifts: [{ name: "Face Pull" }] },
      ],
      pins: [],
    };
    const out = resolvePlan(twice, target, ids());
    expect(out.createdExercises).toHaveLength(1);
    expect(out.slots[0].plannedLifts).toEqual(out.slots[1].plannedLifts);
  });

  it("keeps an existing phase's id when the start date matches", () => {
    const out = resolvePlan(plan, target, ids());
    const cut = out.phases.find((p) => p.startsOn === "2026-09-20")!;
    expect(cut.id).toBe("p_cut");
    expect(cut.calories).toBe(2400); // the plan's number, not the old one
  });

  it("carries a phase the device does not have yet", () => {
    const out = resolvePlan(plan, target, ids());
    expect(out.phases.find((p) => p.startsOn === "2026-10-01")).toMatchObject({
      name: "Maintain",
      calories: 3000,
    });
  });

  it("points a pin at the resolved slot id", () => {
    const out = resolvePlan(plan, target, ids());
    expect(out.pins).toEqual([{ date: "2026-09-22", splitSlotId: "s_upper" }]);
  });

  it("drops a card the plan does not mention, quietly", () => {
    // A deliberate product call: the review screen lists the plan, not what it
    // costs. Sessions logged against the card keep their splitSlotId.
    const out = resolvePlan(plan, target, ids());
    expect(out.slots.map((s) => s.name)).not.toContain("Legs");
  });

  it("drops a pin naming a card the plan does not contain", () => {
    // parsePlanTab already refuses this, so it can only arrive from a payload
    // built in code -- which must still not produce a pin pointing at nothing.
    const dangling: PlanPayload = { ...plan, pins: [{ date: "2026-09-22", cardName: "Nope" }] };
    expect(resolvePlan(dangling, target, ids()).pins).toEqual([]);
  });

  it("resolves an empty plan to an empty split", () => {
    const empty: PlanPayload = { ...plan, phases: [], cards: [], pins: [] };
    const out = resolvePlan(empty, target, ids());
    expect(out.slots).toEqual([]);
    expect(out.phases).toEqual([]);
  });
});

describe("diffPlan", () => {
  const base: PlanPayload = {
    phases: [{ startsOn: "2026-09-20", name: "Cut", calories: 2400, steps: 8000 }],
    cards: [
      { name: "Upper", rotationOrder: 0, kind: "workout", lifts: [{ name: "Bench Press" }] },
      { name: "Lower", rotationOrder: 1, kind: "workout", lifts: [{ name: "Squat" }] },
    ],
    pins: [{ date: "2026-09-22", cardName: "Upper" }],
    mode: "rotation",
    issuedBy: "coach",
    issuedAt: "2026-09-14T10:00:00.000Z",
  };

  const withPhase = (patch: Partial<PlanPayload["phases"][0]>): PlanPayload => ({
    ...base,
    phases: [{ ...base.phases[0], ...patch }],
  });

  it("reports nothing when the plans are identical", () => {
    expect(diffPlan(base, base)).toEqual([]);
  });

  it("reports a changed target with both numbers", () => {
    const changes = diffPlan(base, withPhase({ calories: 2200 }));
    expect(changes).toEqual([
      { area: "Nutrition", subject: "Cut · Calories", kind: "changed", detail: "2400 → 2200" },
    ]);
  });

  it("reports a target that was cleared", () => {
    const changes = diffPlan(base, withPhase({ steps: undefined }));
    expect(changes[0]).toMatchObject({ subject: "Cut · Steps", detail: "8000 → —" });
  });

  it("summarises a phase that is entirely new", () => {
    const added: PlanPayload = {
      ...base,
      phases: [...base.phases, { startsOn: "2026-10-01", name: "Maintain", calories: 3000 }],
    };
    const change = diffPlan(base, added).find((c) => c.subject.includes("Maintain"))!;
    expect(change).toMatchObject({ kind: "added", detail: "Calories 3000" });
  });

  it("describes a phase carrying no targets as having none", () => {
    // A phase with nothing in it used to be a distinct KIND, "untracked". It is
    // now just a phase nobody has put numbers on, which is what it always was.
    const added: PlanPayload = {
      ...base,
      phases: [...base.phases, { startsOn: "2026-10-01", name: "Holiday" }],
    };
    const change = diffPlan(base, added).find((c) => c.subject.includes("Holiday"))!;
    expect(change.detail).toBe("no targets");
  });

  it("reports a changed end date, naming an open end rather than blanking it", () => {
    const ended: PlanPayload = {
      ...base,
      phases: base.phases.map((p) => ({ ...p, endsOn: "2026-12-31" })),
    };
    const change = diffPlan(base, ended).find((c) => c.subject.includes("ends"))!;
    expect(change.detail).toBe("ongoing → 2026-12-31");
  });

  it("reports a changed note, which is the coach talking to the client", () => {
    const noted: PlanPayload = {
      ...base,
      phases: base.phases.map((p) => ({ ...p, note: "keep protein up on rest days" })),
    };
    const change = diffPlan(base, noted).find((c) => c.subject.includes("note"));
    expect(change).toBeDefined();
  });

  it("reports a removed phase", () => {
    const change = diffPlan(base, { ...base, phases: [] })[0];
    expect(change).toMatchObject({ area: "Nutrition", kind: "removed" });
  });

  it("reports changed lifts on a card", () => {
    const next: PlanPayload = {
      ...base,
      cards: [
        { ...base.cards[0], lifts: [{ name: "Bench Press" }, { name: "Incline DB Press" }] },
        base.cards[1],
      ],
    };
    expect(diffPlan(base, next)[0]).toMatchObject({
      area: "Training",
      subject: "Upper · lifts",
      detail: "Bench Press → Bench Press, Incline DB Press",
    });
  });

  it("treats reordered lifts as a change, since order is the preload order", () => {
    const next: PlanPayload = {
      ...base,
      cards: [
        { ...base.cards[0], lifts: [{ name: "Bench Press" }, { name: "Row" }] },
        base.cards[1],
      ],
    };
    const reordered: PlanPayload = {
      ...base,
      cards: [
        { ...base.cards[0], lifts: [{ name: "Row" }, { name: "Bench Press" }] },
        base.cards[1],
      ],
    };
    expect(diffPlan(next, reordered)).toHaveLength(1);
  });

  it("reports a card's position in human numbering, not zero-based", () => {
    const next: PlanPayload = {
      ...base,
      cards: [
        { ...base.cards[0], rotationOrder: 1 },
        { ...base.cards[1], rotationOrder: 0 },
      ],
    };
    const change = diffPlan(base, next).find((c) => c.subject === "Upper · position")!;
    expect(change.detail).toBe("1 → 2");
  });

  it("reads a renamed card as one removed and one added", () => {
    // Honest: as far as logged history is concerned, that is what it is.
    const next: PlanPayload = {
      ...base,
      cards: [{ ...base.cards[0], name: "Push" }, base.cards[1]],
    };
    const training = diffPlan(base, next).filter((c) => c.area === "Training");
    expect(training.map((c) => c.kind).sort()).toEqual(["added", "removed"]);
  });

  it("reports a repointed pin", () => {
    const next: PlanPayload = { ...base, pins: [{ date: "2026-09-22", cardName: "Lower" }] };
    expect(diffPlan(base, next)[0]).toMatchObject({
      area: "Pinned days",
      subject: "2026-09-22",
      detail: "Upper → Lower",
    });
  });

  it("treats every part of a plan as added when there is nothing before it", () => {
    const changes = diffPlan(undefined, base);
    expect(changes.every((c) => c.kind === "added")).toBe(true);
    expect(changes).toHaveLength(4); // one phase, two cards, one pin
  });

  it("ignores issuedAt and issuedBy, which are not changes to the plan", () => {
    const reissued: PlanPayload = { ...base, issuedAt: "2027-01-01T00:00:00Z", issuedBy: "client" };
    expect(diffPlan(base, reissued)).toEqual([]);
  });
});

describe("prescriptions", () => {
  // The sheet is a readable rendering, not a serialisation: a coach opens it in
  // Google Sheets and reads the programme off the screen, so the cell says
  // "Bench Press 3x8-12 @100kg" rather than carrying JSON.
  const CASES: Array<[string, PlanLift]> = [
    ["Bench Press", { name: "Bench Press" }],
    ["Bench Press 3x8", { name: "Bench Press", sets: 3, reps: "8" }],
    ["Bench Press 3x8-12", { name: "Bench Press", sets: 3, reps: "8-12" }],
    ["Bench Press 3x8 @100kg", { name: "Bench Press", sets: 3, reps: "8", load: "100kg" }],
    ["Bench Press 3x8 @RPE 8", { name: "Bench Press", sets: 3, reps: "8", load: "RPE 8" }],
    ["Pull-up 3 sets", { name: "Pull-up", sets: 3 }],
    ["Plank x60s", { name: "Plank", reps: "60s" }],
    ["Push-up @bodyweight", { name: "Push-up", load: "bodyweight" }],
  ];

  it.each(CASES)("round-trips %s", (text, lift) => {
    expect(parseLift(text)).toEqual(lift);
    expect(formatLift(lift)).toBe(text);
  });

  it("takes anything it cannot read as a bare name, rather than losing the lift", () => {
    // Kept whole rather than guessed at: a lift called "Farmer Carry 2x30m each
    // side" reads correctly on the screen, where half of one would not.
    expect(parseLift("Farmer Carry 2x30m each side")).toEqual({
      name: "Farmer Carry 2x30m each side",
    });
    expect(parseLift("21s")).toEqual({ name: "21s" });
    expect(parseLift("   ")).toBeUndefined();
  });

  it("carries sets, reps and load through the tab", () => {
    const plan: PlanPayload = {
      ...PLAN,
      cards: [
        {
          name: "Upper",
          rotationOrder: 0,
          kind: "workout",
          lifts: [
            { name: "Bench Press", sets: 3, reps: "8-12", load: "RPE 8" },
            { name: "Row", sets: 4, reps: "10" },
            { name: "Face Pull" },
          ],
        },
      ],
      pins: [],
    };
    expect(through(plan)!.cards[0].lifts).toEqual(plan.cards[0].lifts);
  });
});

describe("planning mode and weekdays", () => {
  it("carries the mode, so a coach chooses how the split is arranged", () => {
    expect(through({ ...PLAN, mode: "week" })!.mode).toBe("week");
    expect(through({ ...PLAN, mode: "rotation" })!.mode).toBe("rotation");
  });

  it("reads a plan with no mode row as a rotation, which is what it was", () => {
    const rows = grid();
    const metaRows = rows.filter((r) => r[0] === "meta" && r[1] === "mode");
    expect(metaRows).toHaveLength(1);
    const without = rows.filter((r) => !(r[0] === "meta" && r[1] === "mode"));
    expect(parsePlanTab(without)!.mode).toBe("rotation");
  });

  it("carries the day a card sits on in week mode", () => {
    const plan: PlanPayload = {
      ...PLAN,
      mode: "week",
      cards: [
        { name: "Upper", rotationOrder: 0, kind: "workout", lifts: [], weekday: 1 },
        { name: "Rest", rotationOrder: 1, kind: "rest", lifts: [], weekday: 0 },
      ],
      pins: [],
    };
    const out = through(plan)!;
    expect(out.cards.map((c) => c.weekday)).toEqual([1, 0]);
  });

  it("refuses a day column it cannot read, rather than landing the card nowhere", () => {
    const rows = grid();
    setCell(rows, rowOfKind(rows, "card"), "Day", "Someday");
    expect(parsePlanTab(rows)).toBeUndefined();
  });
});

describe("the format version", () => {
  it("is written, so an older app can recognise a plan it cannot read", () => {
    const rows = grid();
    const valueCol = headerIndex(rows, "Value");
    const version = rows.find((r) => r[0] === "meta" && r[1] === "version");
    expect(version?.[valueCol]).toBe(PLAN_FORMAT_VERSION);
  });

  it("refuses a plan from a newer build instead of applying half of it", () => {
    // Applying what it understood and republishing would strip the coach's
    // programming back out of the sheet.
    const rows = grid();
    const valueCol = headerIndex(rows, "Value");
    const version = rows.find((r) => r[0] === "meta" && r[1] === "version")!;
    version[valueCol] = PLAN_FORMAT_VERSION + 1;
    expect(parsePlanTab(rows)).toBeUndefined();
  });

  it("reads a plan with no version row, which is one written before this", () => {
    const rows = grid().filter((r) => !(r[0] === "meta" && r[1] === "version"));
    expect(parsePlanTab(rows)).toBeDefined();
  });
});
