import { describe, expect, it } from "vitest";
import { buildClientSnapshot } from "../client-snapshot";
import { buildSheetTabs, SHEET_TABS, type SyncSource } from "../sync";
import { buildPlanTab } from "../plan-tab";

/**
 * The real test here is a round trip: take a store state, render it to the
 * sheet exactly as a client's app would, and rebuild it as the coach's app
 * would. Anything the sheet cannot carry shows up as a difference.
 *
 * Asserting against hand-written tab fixtures instead would only prove that
 * this file agrees with itself; it is `csv.ts` that decides what the sheet
 * actually looks like, and that is what must be read back.
 */

const DAY = new Date(2026, 8, 12, 9, 30, 0).getTime();
const LATER = new Date(2026, 8, 12, 10, 15, 0).getTime();

const SOURCE: SyncSource = {
  unit: "lbs",
  planningMode: "rotation",
  exercises: [
    { id: "e_bench", name: "Bench Press", type: "main" },
    { id: "e_row", name: "Barbell Row", type: "accessory" },
    { id: "e_tread", name: "Treadmill", type: "cardio" },
  ],
  slots: [
    { id: "s_upper", name: "Upper", rotationOrder: 0 },
    { id: "s_lower", name: "Lower", rotationOrder: 1 },
  ],
  sessions: [
    { id: "sess_1", splitSlotId: "s_upper", startedAt: DAY, endedAt: LATER, note: "felt strong" },
    {
      id: "card_1",
      kind: "cardio",
      startedAt: DAY,
      endedAt: DAY + 28 * 60_000,
      cardioExerciseId: "e_tread",
      durationMinutes: 28,
      distance: 3.1,
    },
  ],
  sets: [
    {
      id: "set_1",
      sessionId: "sess_1",
      exerciseId: "e_bench",
      weight: 225,
      reps: 5,
      rpe: 8,
      loggedAt: DAY,
    },
    {
      id: "set_2",
      sessionId: "sess_1",
      exerciseId: "e_row",
      weight: 135,
      reps: 10,
      setupNote: "seat 4",
      loggedAt: DAY + 60_000,
    },
  ],
  dailyLogs: [
    {
      date: "2026-09-12",
      calories: 2400,
      protein: 190,
      carbs: 250,
      fat: 70,
      steps: 11000,
      bodyweight: 181.4,
    },
    { date: "2026-09-13", steps: 0 },
  ],
  nutritionPhases: [],
  plannedDays: [],
};

function roundTrip(source: SyncSource = SOURCE) {
  return buildClientSnapshot(buildSheetTabs(source, { issuedAt: "2026-09-14T10:00:00.000Z" }));
}

describe("rebuilding a client's state from their sheet", () => {
  it("recovers every set with its weight, reps, RPE and setup note", () => {
    const snap = roundTrip();
    expect(snap.sets).toHaveLength(2);
    const bench = snap.sets.find((s) => s.id === "set_1")!;
    expect(bench).toMatchObject({ weight: 225, reps: 5, rpe: 8 });
    expect(snap.sets.find((s) => s.id === "set_2")!.setupNote).toBe("seat 4");
  });

  it("synthesises an exercise per distinct name, so nothing renders as Unknown", () => {
    const snap = roundTrip();
    const names = snap.exercises.map((e) => e.name).sort();
    expect(names).toEqual(["Barbell Row", "Bench Press", "Treadmill"]);
  });

  it("keeps each exercise's type, which the sheet carries", () => {
    const snap = roundTrip();
    expect(snap.exercises.find((e) => e.name === "Bench Press")!.type).toBe("main");
    expect(snap.exercises.find((e) => e.name === "Barbell Row")!.type).toBe("accessory");
    // Cardio matters: it is the one type the app actually branches on.
    expect(snap.exercises.find((e) => e.name === "Treadmill")!.type).toBe("cardio");
  });

  it("joins a set to its session, so History can group it", () => {
    const snap = roundTrip();
    const session = snap.sessions.find((s) => s.id === "sess_1")!;
    expect(snap.sets.every((s) => s.sessionId === session.id)).toBe(true);
  });

  it("keeps an unfinished workout unfinished", () => {
    const snap = roundTrip({
      ...SOURCE,
      sessions: [{ ...SOURCE.sessions[0], endedAt: undefined }],
    });
    expect(snap.sessions[0].endedAt).toBeUndefined();
  });

  it("joins sets from a workout that has no split card", () => {
    const snap = roundTrip({
      ...SOURCE,
      sessions: [{ ...SOURCE.sessions[0], splitSlotId: undefined }],
    });
    expect(snap.sets.map((set) => set.sessionId)).toEqual(["sess_1", "sess_1"]);
  });

  it("keeps two workouts on the same card and day separate using their times", () => {
    const evening = DAY + 8 * 60 * 60_000;
    const snap = roundTrip({
      ...SOURCE,
      sessions: [
        SOURCE.sessions[0],
        { ...SOURCE.sessions[0], id: "sess_2", startedAt: evening, endedAt: evening + 60_000 },
      ],
      sets: [
        ...SOURCE.sets,
        { ...SOURCE.sets[0], id: "set_3", sessionId: "sess_2", loggedAt: evening },
      ],
    });
    expect(snap.sets.map((set) => set.sessionId)).toEqual(["sess_1", "sess_1", "sess_2"]);
  });

  it("recovers distance units when the client has only logged cardio", () => {
    const snap = roundTrip({
      ...SOURCE,
      unit: "kg",
      sets: [],
      dailyLogs: [],
      sessions: [SOURCE.sessions[1]],
    });
    expect(snap.unit).toBe("kg");
  });

  it("keeps sets logged after midnight attached to the workout that started the previous day", () => {
    const startedAt = new Date(2026, 8, 12, 23, 30).getTime();
    const loggedAt = new Date(2026, 8, 13, 0, 15).getTime();
    const endedAt = new Date(2026, 8, 13, 0, 30).getTime();
    const snap = roundTrip({
      ...SOURCE,
      sessions: [{ ...SOURCE.sessions[0], startedAt, endedAt }],
      sets: [{ ...SOURCE.sets[0], loggedAt }],
    });
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0].endedAt).toBe(endedAt);
    expect(snap.sets[0].sessionId).toBe("sess_1");
  });

  it("attaches the session to a slot named by the sheet", () => {
    const snap = roundTrip();
    const session = snap.sessions.find((s) => s.id === "sess_1")!;
    const slot = snap.slots.find((s) => s.id === session.splitSlotId)!;
    expect(slot.name).toBe("Upper");
  });

  it("keeps a session note", () => {
    expect(roundTrip().sessions.find((s) => s.id === "sess_1")!.note).toBe("felt strong");
  });

  it("recovers a cardio bout as a cardio session, not a strength one", () => {
    const snap = roundTrip();
    const cardio = snap.sessions.find((s) => s.id === "card_1")!;
    expect(cardio.kind).toBe("cardio");
    expect(cardio.durationMinutes).toBe(28);
    expect(cardio.distance).toBe(3.1);
    expect(cardio.splitSlotId).toBeUndefined();
  });

  it("recovers daily logs, a logged zero included", () => {
    const snap = roundTrip();
    expect(snap.dailyLogs.find((d) => d.date === "2026-09-12")).toMatchObject({
      calories: 2400,
      steps: 11000,
      bodyweight: 181.4,
    });
    // A logged 0 is a value, not an absence, and must survive the round trip
    // as one - which is the same claim the CSV layer makes about it.
    expect(snap.dailyLogs.find((d) => d.date === "2026-09-13")!.steps).toBe(0);
  });

  it("puts a set on the same calendar day the client logged it", () => {
    // Charts and the weekly counts group by day, so an hour of timezone drift
    // would move a workout between days.
    const snap = roundTrip();
    const logged = new Date(snap.sets.find((s) => s.id === "set_1")!.loggedAt);
    expect(logged.getFullYear()).toBe(2026);
    expect(logged.getMonth()).toBe(8);
    expect(logged.getDate()).toBe(12);
  });

  it("reads the unit out of the sheet rather than assuming lbs", () => {
    expect(roundTrip({ ...SOURCE, unit: "kg" }).unit).toBe("kg");
  });

  it("is deterministic, so a re-pull does not look like all-new rows to React", () => {
    expect(JSON.stringify(roundTrip())).toEqual(JSON.stringify(roundTrip()));
  });
});

describe("the plan inside a client's sheet", () => {
  it("reads the plan back and resolves its cards onto the slots the sets use", () => {
    const tabs = buildSheetTabs(SOURCE, { issuedAt: "2026-09-14T10:00:00.000Z" });
    tabs[SHEET_TABS.plan] = buildPlanTab({
      phases: [{ startsOn: "2026-09-20", name: "Cut", calories: 2200 }],
      cards: [
        { name: "Upper", rotationOrder: 0, kind: "workout", lifts: [{ name: "Bench Press" }] },
      ],
      pins: [{ date: "2026-09-22", cardName: "Upper" }],
      mode: "rotation",
      issuedBy: "coach",
      issuedAt: "2026-09-14T10:00:00.000Z",
    });

    const snap = buildClientSnapshot(tabs);

    expect(snap.nutritionPhases[0]).toMatchObject({ name: "Cut", calories: 2200 });
    // The card must land on the SAME slot the logged sets hang off, or Upper
    // would appear twice in the split under two different ids.
    const upper = snap.slots.filter((s) => s.name === "Upper");
    expect(upper).toHaveLength(1);
    expect(snap.plannedDays[0].splitSlotId).toBe(upper[0].id);
    expect(upper[0].plannedLifts?.map((l) => l.exerciseId)).toEqual([
      snap.exercises.find((e) => e.name === "Bench Press")!.id,
    ]);
  });

  it("leaves the plan absent when the sheet has no readable one", () => {
    const snap = roundTrip();
    expect(snap.plan).toBeDefined(); // buildSheetTabs wrote one
    expect(buildClientSnapshot({}).plan).toBeUndefined();
  });
});

describe("tolerating an incomplete sheet", () => {
  it("returns an empty snapshot for a client who has synced nothing", () => {
    const snap = buildClientSnapshot({});
    expect(snap.sets).toEqual([]);
    expect(snap.sessions).toEqual([]);
    expect(snap.exercises).toEqual([]);
    expect(snap.dailyLogs).toEqual([]);
  });

  it("returns an empty snapshot rather than throwing on undefined tabs", () => {
    expect(buildClientSnapshot(undefined).sets).toEqual([]);
  });

  it("keeps a set whose session is missing from the sheet", () => {
    // A partially readable sheet is more useful than none: the set still
    // charts, it just belongs to no session.
    const tabs = buildSheetTabs(SOURCE, undefined);
    delete tabs[SHEET_TABS.sessions];
    const snap = buildClientSnapshot(tabs);
    expect(snap.sets).toHaveLength(2);
    expect(snap.sets[0].sessionId).toBe("");
  });

  it("skips a set row with no weight or reps rather than inventing one", () => {
    const tabs = buildSheetTabs(SOURCE, undefined);
    const header = tabs[SHEET_TABS.sets][0];
    const weightCol = header.indexOf("Weight");
    tabs[SHEET_TABS.sets][1][weightCol] = "";
    const snap = buildClientSnapshot(tabs);
    expect(snap.sets).toHaveLength(1);
  });

  it("reads columns by name, so an inserted column changes nothing", () => {
    const tabs = buildSheetTabs(SOURCE, undefined);
    tabs[SHEET_TABS.sets] = tabs[SHEET_TABS.sets].map((row, i) => {
      const copy = [...row];
      copy.splice(1, 0, i === 0 ? "My notes" : "felt heavy");
      return copy;
    });
    expect(buildClientSnapshot(tabs).sets).toHaveLength(2);
  });

  it("ignores a tab with only a header row", () => {
    const tabs = buildSheetTabs(SOURCE, undefined);
    tabs[SHEET_TABS.sets] = [tabs[SHEET_TABS.sets][0]];
    expect(buildClientSnapshot(tabs).sets).toEqual([]);
  });
});
