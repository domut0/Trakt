import { describe, expect, it } from "vitest";
import type { FoodEntry, Meal } from "../food";
import type { PlannedWorkout } from "../plan";
import type { Exercise, SplitSlot, WorkoutSession, WorkoutSet } from "../store";
import {
  buildTimelineBands,
  canvasHeightPx,
  heightPx,
  initialScrollPx,
  minutesOfDay,
  offsetPx,
  MIN_BAND_MINUTES,
  TIMELINE_MINUTES,
  type BuildTimelineInput,
  type TimelineBand,
} from "../timeline";

/**
 * 2026-08-25 is a Tuesday. Every `now` below is built with explicit local
 * components rather than parsed from a string, because `new Date("2026-08-25")`
 * is UTC midnight and would land on the previous day for anyone west of
 * Greenwich, which would make these tests pass or fail by timezone.
 */
const DATE = "2026-08-25";
const at = (h: number, m = 0) => new Date(2026, 7, 25, h, m, 0, 0);

const MEALS: Meal[] = [
  { id: "m_break", name: "Breakfast", fromMinutes: 360, toMinutes: 660, rank: 0 },
  { id: "m_lunch", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 },
  // All-day, expressed as a window that does not advance. Snacks ships like
  // this by default, so the wrap case is the common case, not an oddity.
  { id: "m_snack", name: "Snacks", fromMinutes: 0, toMinutes: 0, rank: 2 },
];

function entry(over: Partial<FoodEntry> & Pick<FoodEntry, "id" | "mealId">): FoodEntry {
  return {
    date: DATE,
    quantity: 100,
    unit: "g",
    name: "Oats",
    basisQuantity: 100,
    basisUnit: "g",
    calories: 380,
    loggedAt: 0,
    ...over,
  } as FoodEntry;
}

function base(over: Partial<BuildTimelineInput> = {}): BuildTimelineInput {
  return {
    date: DATE,
    now: at(12),
    meals: MEALS,
    foodEntries: [],
    sessions: [],
    sets: [],
    exercises: [],
    slots: [],
    unit: "lbs",
    ...over,
  };
}

const zone = (bands: TimelineBand[], mealId: string) => bands.find((b) => b.mealId === mealId)!;
const blocks = (bands: TimelineBand[]) => bands.filter((b) => b.layer === "block");

describe("geometry", () => {
  it("places a minute at the same offset the hour rules will use", () => {
    expect(offsetPx(0, 60)).toBe(0);
    expect(offsetPx(60, 60)).toBe(60);
    expect(offsetPx(90, 56)).toBeCloseTo(84);
  });

  it("clamps a band that would escape the canvas", () => {
    expect(offsetPx(-30, 60)).toBe(0);
    expect(offsetPx(TIMELINE_MINUTES + 500, 60)).toBe(canvasHeightPx(60));
  });

  it("floors a short band's HEIGHT without lying about its end time", () => {
    const bout: TimelineBand = {
      id: "b",
      kind: "cardio",
      state: "actual",
      layer: "block",
      fromMinutes: 600,
      toMinutes: 604,
      label: "Row",
    };
    // Drawn as if it were MIN_BAND_MINUTES long...
    expect(heightPx(bout, 60)).toBeCloseTo(MIN_BAND_MINUTES);
    // ...but the model still reports the real four minute span, which is what
    // anything reading the band as data depends on.
    expect(bout.toMinutes - bout.fromMinutes).toBe(4);
  });
});

describe("meal zones", () => {
  it("draws an empty window as planned and a used one as actual", () => {
    const bands = buildTimelineBands(
      base({ foodEntries: [entry({ id: "e1", mealId: "m_break" })] }),
    );
    expect(zone(bands, "m_break").state).toBe("actual");
    expect(zone(bands, "m_break").detail).toBe("1 item");
    expect(zone(bands, "m_lunch").state).toBe("planned");
    expect(zone(bands, "m_lunch").detail).toBeUndefined();
  });

  it("counts only entries on the day being shown", () => {
    const bands = buildTimelineBands(
      base({
        foodEntries: [
          entry({ id: "e1", mealId: "m_break" }),
          entry({ id: "e2", mealId: "m_break", date: "2026-08-24" }),
        ],
      }),
    );
    expect(zone(bands, "m_break").detail).toBe("1 item");
  });

  it("NEVER reads loggedAt", () => {
    // The whole point of decision 3. Both of these were stamped as a batch at
    // 03:00 by an import, and both still belong to their own meal's window.
    const stamped = Date.UTC(2026, 7, 25, 3, 0);
    const bands = buildTimelineBands(
      base({
        foodEntries: [
          entry({ id: "e1", mealId: "m_break", loggedAt: stamped }),
          entry({ id: "e2", mealId: "m_lunch", loggedAt: stamped + 1 }),
        ],
      }),
    );
    expect(zone(bands, "m_break").fromMinutes).toBe(360);
    expect(zone(bands, "m_lunch").fromMinutes).toBe(660);
  });

  it("clamps an all-day window to the end of the day rather than splitting it", () => {
    const bands = buildTimelineBands(base());
    const snacks = zone(bands, "m_snack");
    expect(snacks.fromMinutes).toBe(0);
    expect(snacks.toMinutes).toBe(TIMELINE_MINUTES);
    // One band, so it is tappable once and its entry count is stated once.
    expect(bands.filter((b) => b.mealId === "m_snack")).toHaveLength(1);
  });

  it("renders a zone for every meal, in rank order", () => {
    const bands = buildTimelineBands(base());
    expect(bands.filter((b) => b.layer === "zone").map((b) => b.label)).toEqual([
      "Breakfast",
      "Lunch",
      "Snacks",
    ]);
  });
});

describe("training blocks", () => {
  const session = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
    id: "s1",
    splitSlotId: "slot1",
    startedAt: at(17).getTime(),
    endedAt: at(18, 15).getTime(),
    ...over,
  });
  const SLOTS: SplitSlot[] = [{ id: "slot1", name: "Heavy Bench", rotationOrder: 0 }];
  const SETS: WorkoutSet[] = [
    { id: "w1", sessionId: "s1", exerciseId: "e", weight: 100, reps: 5, loggedAt: 0 },
    { id: "w2", sessionId: "s1", exerciseId: "e", weight: 100, reps: 5, loggedAt: 0 },
  ];

  it("draws a logged session filled, from its own start and end", () => {
    const bands = blocks(
      buildTimelineBands(base({ sessions: [session()], sets: SETS, slots: SLOTS })),
    );
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      state: "actual",
      layer: "block",
      label: "Heavy Bench",
      detail: "2 sets",
      fromMinutes: 17 * 60,
      toMinutes: 18 * 60 + 15,
    });
  });

  it("runs an unfinished session to now on today, and not at all on a past day", () => {
    const open = session({ endedAt: undefined });
    const today = blocks(buildTimelineBands(base({ sessions: [open], slots: SLOTS, now: at(18) })));
    expect(today[0].openEnded).toBe(true);
    expect(today[0].toMinutes).toBe(18 * 60);

    // Same session, viewed from a later day. It is not still running.
    const later = blocks(
      buildTimelineBands(base({ sessions: [open], slots: SLOTS, now: new Date(2026, 7, 26, 9) })),
    );
    expect(later[0].toMinutes).toBe(later[0].fromMinutes);
  });

  it("runs a session that crossed midnight to the end of the day it started", () => {
    const overnight = session({
      startedAt: at(23).getTime(),
      endedAt: new Date(2026, 7, 26, 0, 40).getTime(),
    });
    const [band] = blocks(buildTimelineBands(base({ sessions: [overnight], slots: SLOTS })));
    expect(band.fromMinutes).toBe(23 * 60);
    // Not 40, which is what raw minutes-of-day arithmetic would give.
    expect(band.toMinutes).toBe(TIMELINE_MINUTES);
  });

  it("labels cardio from its exercise and states duration and distance", () => {
    const exercises: Exercise[] = [{ id: "ex_row", name: "Rower" } as Exercise];
    const cardio = session({
      id: "s2",
      kind: "cardio",
      splitSlotId: undefined,
      cardioExerciseId: "ex_row",
      durationMinutes: 28,
      distance: 5,
    });
    const [band] = blocks(buildTimelineBands(base({ sessions: [cardio], exercises })));
    expect(band.kind).toBe("cardio");
    expect(band.label).toBe("Rower");
    expect(band.detail).toBe("28 min · 5 mi");
  });

  it("draws a planned workout dashed when nothing was logged", () => {
    const planned: PlannedWorkout = {
      name: "Squat day",
      exerciseIds: ["a", "b"],
      atMinutes: 17 * 60,
    };
    const [band] = blocks(buildTimelineBands(base({ planned })));
    expect(band).toMatchObject({
      state: "planned",
      fromMinutes: 1020,
      toMinutes: 1080, // the 60 minute default
      label: "Squat day",
      detail: "2 lifts",
    });
  });

  it("does not draw a plan with no time", () => {
    const planned: PlannedWorkout = { name: "Squat day", exerciseIds: ["a"] };
    expect(blocks(buildTimelineBands(base({ planned })))).toHaveLength(0);
  });

  it("suppresses the planned ghost once a session exists", () => {
    const planned: PlannedWorkout = { name: "Squat day", exerciseIds: ["a"], atMinutes: 1020 };
    const bands = blocks(
      buildTimelineBands(base({ planned, sessions: [session()], slots: SLOTS })),
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].state).toBe("actual");
  });

  it("buckets a session by the day it STARTED, matching the other surfaces", () => {
    const yesterdayEvening = session({ startedAt: new Date(2026, 7, 24, 23).getTime() });
    expect(
      blocks(buildTimelineBands(base({ sessions: [yesterdayEvening], slots: SLOTS }))),
    ).toHaveLength(0);
  });
});

describe("initial scroll", () => {
  it("puts the now line about a third down on today", () => {
    const bands = buildTimelineBands(base());
    const px = initialScrollPx(bands, DATE, at(12), 60, 600);
    // 12:00 is 720px in; a third of a 600px viewport is 200px of lead-in.
    expect(px).toBeCloseTo(520);
  });

  it("never scrolls past the end of the canvas", () => {
    const px = initialScrollPx([], DATE, at(23, 59), 60, 600);
    expect(px).toBeLessThanOrEqual(canvasHeightPx(60) - 600);
  });

  it("never returns a negative scroll", () => {
    expect(initialScrollPx([], DATE, at(0, 5), 60, 600)).toBe(0);
  });

  it("anchors on the first band, not the clock, when the day is not today", () => {
    const bands = buildTimelineBands(
      base({ foodEntries: [entry({ id: "e1", mealId: "m_lunch" })] }),
    );
    // Snacks starts at 00:00, so the earliest band is midnight and the target
    // is above the top of the canvas, which clamps to zero.
    expect(initialScrollPx(bands, "2026-08-20", at(12), 60, 600)).toBe(0);
  });
});

describe("minutesOfDay", () => {
  it("reads local wall clock, not UTC", () => {
    expect(minutesOfDay(at(6, 30))).toBe(390);
    expect(minutesOfDay(at(0, 0))).toBe(0);
  });
});
