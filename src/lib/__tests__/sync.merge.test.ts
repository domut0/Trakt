import { describe, expect, it } from "vitest";
import {
  ID_HEADER,
  SHEET_TABS,
  buildBase,
  buildSheetTabs,
  isNoopMerge,
  mergeFromSheet,
  type SyncBase,
  type SyncSource,
} from "../sync";
import type { CellValue } from "../csv";
import type { DailyLog, WorkoutSession, WorkoutSet } from "../store";

const T = new Date(2026, 7, 12, 14, 30, 0).getTime();

function source(overrides: Partial<SyncSource> = {}): SyncSource {
  return {
    exercises: [{ id: "e_bench", name: "Bench Press", type: "main" }],
    slots: [{ id: "s_hb", name: "Heavy Bench", rotationOrder: 0 }],
    sessions: [{ id: "sess_1", splitSlotId: "s_hb", startedAt: T, endedAt: T + 3600_000 }],
    sets: [
      {
        id: "set_1",
        sessionId: "sess_1",
        exerciseId: "e_bench",
        weight: 225,
        reps: 5,
        loggedAt: T,
      },
    ],
    dailyLogs: [{ date: "2026-08-12", calories: 2400, protein: 180 }],
    unit: "lbs",
    ...overrides,
  };
}

/** Builds a `sets` tab the way the sheet would hand one back. */
function setsTab(rows: Array<Record<string, CellValue>>): CellValue[][] {
  const headers = [ID_HEADER, "Weight", "Reps", "RPE", "Setup Note"];
  return [headers, ...rows.map((r) => headers.map((h) => r[h]))];
}

function dailyTab(rows: Array<Record<string, CellValue>>): CellValue[][] {
  const headers = ["Date", "Calories", "Protein (g)", "Carbs (g)", "Steps", "Untracked"];
  return [headers, ...rows.map((r) => headers.map((h) => r[h]))];
}

function sessionsTab(rows: Array<Record<string, CellValue>>): CellValue[][] {
  const headers = [ID_HEADER, "Note"];
  return [headers, ...rows.map((r) => headers.map((h) => r[h]))];
}

describe("buildBase", () => {
  it("captures only the editable fields, not the whole record", () => {
    const base = buildBase(source(), 1);
    expect(base.sets.set_1).toEqual({
      weight: 225,
      reps: 5,
      rpe: undefined,
      setupNote: undefined,
    });
    // loggedAt, sessionId and exerciseId are the app's business and are never
    // merged, so keeping them would double the stored size for nothing.
    expect(base.sets.set_1).not.toHaveProperty("loggedAt");
  });

  it("keys daily logs by date, since that is their primary key", () => {
    const base = buildBase(source(), 1);
    expect(Object.keys(base.dailyLogs)).toEqual(["2026-08-12"]);
  });
});

describe("mergeFromSheet: bootstrap", () => {
  it("merges nothing when there is no base", () => {
    const result = mergeFromSheet(undefined, source(), { [SHEET_TABS.sets]: setsTab([]) });
    expect(result.report.firstSync).toBe(true);
    expect(isNoopMerge(result)).toBe(true);
  });

  it("merges nothing when the sheet returned no tabs", () => {
    const result = mergeFromSheet(buildBase(source(), 1), source(), undefined);
    expect(isNoopMerge(result)).toBe(true);
  });
});

describe("mergeFromSheet: the four field cases", () => {
  const local = source();
  const base = buildBase(local, 1);

  it("neither side changed: nothing happens", () => {
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: 225, Reps: 5 }]),
    });
    expect(isNoopMerge(result)).toBe(true);
    expect(result.report.collisions).toHaveLength(0);
  });

  it("sheet changed, app did not: the sheet edit is applied", () => {
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: 235, Reps: 5 }]),
    });
    expect(result.setPatches).toEqual([{ id: "set_1", patch: { weight: 235 } }]);
    expect(result.report.applied).toBe(1);
    expect(result.report.collisions).toHaveLength(0);
  });

  it("app changed, sheet did not: nothing is applied and the app value survives", () => {
    const moved = source({
      sets: [{ ...local.sets[0], weight: 245 }],
    });
    const result = mergeFromSheet(base, moved, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: 225, Reps: 5 }]),
    });
    expect(isNoopMerge(result)).toBe(true);
  });

  it("both changed to DIFFERENT values: the app wins and a collision is recorded", () => {
    const moved = source({ sets: [{ ...local.sets[0], weight: 245 }] });
    const result = mergeFromSheet(base, moved, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: 235, Reps: 5 }]),
    });
    expect(isNoopMerge(result)).toBe(true);
    expect(result.report.collisions).toEqual([
      { tab: "sets", key: "set_1", field: "weight", sheetValue: 235, appValue: 245 },
    ]);
  });

  it("both changed to the SAME value: converged, so not a collision", () => {
    // Without this the user gets a conflict report for a change they made once
    // and that both sides already agree on, which is noise that trains them to
    // ignore the real ones.
    const moved = source({ sets: [{ ...local.sets[0], weight: 235 }] });
    const result = mergeFromSheet(base, moved, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: 235, Reps: 5 }]),
    });
    expect(isNoopMerge(result)).toBe(true);
    expect(result.report.collisions).toHaveLength(0);
  });

  it("reports collisions per FIELD, not per record", () => {
    const moved = source({
      dailyLogs: [{ date: "2026-08-12", calories: 2400, protein: 200 }],
    });
    const result = mergeFromSheet(base, moved, {
      [SHEET_TABS.daily]: dailyTab([{ Date: "2026-08-12", Calories: 2100, "Protein (g)": 180 }]),
    });
    // Calories moved only in the sheet, so it applies. Protein moved only in
    // the app, so it does not. One record, two independent outcomes.
    expect(result.dailyPatches).toEqual([{ date: "2026-08-12", patch: { calories: 2100 } }]);
    expect(result.report.collisions).toHaveLength(0);
  });
});

describe("mergeFromSheet: clearing and required fields", () => {
  const local = source({
    sets: [
      {
        id: "set_1",
        sessionId: "sess_1",
        exerciseId: "e_bench",
        weight: 225,
        reps: 5,
        rpe: 8,
        loggedAt: T,
      },
    ],
  });
  const base = buildBase(local, 1);

  it("blanking an OPTIONAL field clears it", () => {
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: 225, Reps: 5, RPE: "" }]),
    });
    expect(result.setPatches).toEqual([{ id: "set_1", patch: { rpe: undefined } }]);
  });

  it("blanking a REQUIRED field is ignored, never written as NaN", () => {
    // There is no such thing as a set with no weight. A cleared cell here is a
    // mistake to survive, not an edit to honour.
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: "", Reps: 5, RPE: 8 }]),
    });
    expect(isNoopMerge(result)).toBe(true);
  });

  it("a required field holding unparseable text is ignored", () => {
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: "225 lbs", Reps: 5, RPE: 8 }]),
    });
    expect(isNoopMerge(result)).toBe(true);
  });

  it("reads a numeric string as a number rather than as an edit", () => {
    // Sheets hands back "225" for a text-formatted cell. Comparing that to 225
    // would manufacture an edit on every single pull.
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([{ [ID_HEADER]: "set_1", Weight: "225", Reps: "5", RPE: "8" }]),
    });
    expect(isNoopMerge(result)).toBe(true);
  });

  it("treats a blank cell as absent, never as zero", () => {
    // isDailyLogEmpty counts a present 0 as real data, so turning "" into 0
    // would resurrect deleted days as logged ones.
    const dailyLocal = source({ dailyLogs: [{ date: "2026-08-12", calories: 2400 }] });
    const dailyBase = buildBase(dailyLocal, 1);
    const result = mergeFromSheet(dailyBase, dailyLocal, {
      [SHEET_TABS.daily]: dailyTab([{ Date: "2026-08-12", Calories: "" }]),
    });
    expect(result.dailyPatches).toEqual([{ date: "2026-08-12", patch: { calories: undefined } }]);
  });

  it("keeps a logged zero as a real value", () => {
    const zeroLocal = source({ dailyLogs: [{ date: "2026-08-12", steps: 5000 }] });
    const zeroBase = buildBase(zeroLocal, 1);
    const result = mergeFromSheet(zeroBase, zeroLocal, {
      [SHEET_TABS.daily]: dailyTab([{ Date: "2026-08-12", Steps: 0 }]),
    });
    expect(result.dailyPatches).toEqual([{ date: "2026-08-12", patch: { steps: 0 } }]);
  });

  it("reads a checkbox as a boolean and accepts TRUE/FALSE text", () => {
    const untrackedLocal = source({ dailyLogs: [{ date: "2026-08-12", calories: 2400 }] });
    const untrackedBase = buildBase(untrackedLocal, 1);

    for (const cell of [true, "TRUE", "yes"] as CellValue[]) {
      const result = mergeFromSheet(untrackedBase, untrackedLocal, {
        [SHEET_TABS.daily]: dailyTab([{ Date: "2026-08-12", Calories: 2400, Untracked: cell }]),
      });
      expect(result.dailyPatches).toEqual([{ date: "2026-08-12", patch: { isUntracked: true } }]);
    }
  });
});

describe("mergeFromSheet: structural cases", () => {
  const local = source();
  const base = buildBase(local, 1);

  it("ignores a sheet row whose id the app has never seen", () => {
    // Rows cannot be created from the sheet: inventing a set from a typed row
    // is not something the user asked for, and it has no session to belong to.
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([
        { [ID_HEADER]: "set_1", Weight: 225, Reps: 5 },
        { [ID_HEADER]: "set_invented", Weight: 315, Reps: 1 },
      ]),
    });
    expect(isNoopMerge(result)).toBe(true);
    expect(result.report.unknownRows).toBe(1);
  });

  it("never treats a row missing from the sheet as a deletion", () => {
    // Sorting, filtering and fat-fingering rows are all ordinary spreadsheet
    // actions, and a training log is not re-derivable.
    const result = mergeFromSheet(base, local, { [SHEET_TABS.sets]: setsTab([]) });
    expect(isNoopMerge(result)).toBe(true);
    expect(result.report.missingRows).toBe(1);
  });

  it("creates a daily log for a day typed into the sheet", () => {
    // The one table where creation IS allowed: the key is the calendar date, so
    // a new row is unambiguous, and back-filling nutrition is the whole point.
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.daily]: dailyTab([
        { Date: "2026-08-12", Calories: 2400, "Protein (g)": 180 },
        { Date: "2026-08-13", Calories: 2600, "Protein (g)": 190 },
      ]),
    });
    expect(result.dailyPatches).toEqual([
      { date: "2026-08-13", patch: { calories: 2600, protein: 190 } },
    ]);
  });

  it("lets the app win for a day created on the phone since the last push", () => {
    const withNewDay = source({
      dailyLogs: [
        { date: "2026-08-12", calories: 2400, protein: 180 },
        { date: "2026-08-13", calories: 2000 },
      ],
    });
    const result = mergeFromSheet(base, withNewDay, {
      [SHEET_TABS.daily]: dailyTab([{ Date: "2026-08-13", Calories: 9999 }]),
    });
    expect(isNoopMerge(result)).toBe(true);
  });

  it("applies a session note edit", () => {
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sessions]: sessionsTab([{ [ID_HEADER]: "sess_1", Note: "shoulder tweaked" }]),
    });
    expect(result.sessionPatches).toEqual([{ id: "sess_1", patch: { note: "shoulder tweaked" } }]);
  });
});

describe("mergeFromSheet: refusing an unreadable tab", () => {
  const local = source();
  const base = buildBase(local, 1);

  it("skips a tab whose ID column is gone rather than guessing by position", () => {
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: [
        ["Weight", "Reps"],
        [235, 5],
      ],
    });
    expect(isNoopMerge(result)).toBe(true);
    expect(result.report.skippedTabs).toContain("sets");
  });

  it("skips a tab with duplicate ids instead of silently picking a winner", () => {
    // Dragging the fill handle down the ID column is the usual cause.
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: setsTab([
        { [ID_HEADER]: "set_1", Weight: 235, Reps: 5 },
        { [ID_HEADER]: "set_1", Weight: 245, Reps: 5 },
      ]),
    });
    expect(isNoopMerge(result)).toBe(true);
    expect(result.report.skippedTabs).toContain("sets");
  });

  it("survives a user INSERTING a column, by locating fields by header name", () => {
    const headers = [ID_HEADER, "My notes", "Weight", "Reps"];
    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.sets]: [headers, ["set_1", "felt heavy", 235, 5]],
    });
    expect(result.setPatches).toEqual([{ id: "set_1", patch: { weight: 235 } }]);
  });

  it("treats a DELETED column as no opinion rather than as cleared", () => {
    const withRpe = source({
      sets: [{ ...local.sets[0], rpe: 8 }],
    });
    const rpeBase = buildBase(withRpe, 1);
    const result = mergeFromSheet(rpeBase, withRpe, {
      [SHEET_TABS.sets]: [
        [ID_HEADER, "Weight", "Reps"],
        ["set_1", 225, 5],
      ],
    });
    expect(isNoopMerge(result)).toBe(true);
  });
});

describe("buildSheetTabs", () => {
  it("prepends an ID column to the two-way record tabs", () => {
    const tabs = buildSheetTabs(source());
    expect(tabs[SHEET_TABS.sets][0][0]).toBe(ID_HEADER);
    expect(tabs[SHEET_TABS.sessions][0][0]).toBe(ID_HEADER);
  });

  it("gives the daily tab no ID column, because its date IS the key", () => {
    const tabs = buildSheetTabs(source());
    expect(tabs[SHEET_TABS.daily][0][0]).toBe("Date");
  });

  it("does not emit the _sync tab, which the script owns", () => {
    expect(Object.keys(buildSheetTabs(source()))).not.toContain(SHEET_TABS.meta);
  });

  it("round-trips through the merge as a no-op", () => {
    // The strongest single guarantee here: pushing, then immediately pulling
    // what was pushed, must change nothing. If the payload and the parser
    // disagree about any header or coercion, this fails.
    const state = source({
      sets: [
        {
          id: "set_1",
          sessionId: "sess_1",
          exerciseId: "e_bench",
          weight: 225,
          reps: 5,
          rpe: 8,
          setupNote: "seat 4",
          loggedAt: T,
        },
      ],
      sessions: [
        { id: "sess_1", splitSlotId: "s_hb", startedAt: T, endedAt: T + 3600_000, note: "good" },
      ],
      dailyLogs: [
        { date: "2026-08-12", calories: 2400, protein: 180, steps: 0, isUntracked: false },
      ],
    });
    const tabs = buildSheetTabs(state);
    const result = mergeFromSheet(buildBase(state, 1), state, tabs);

    expect(result.report.collisions).toHaveLength(0);
    expect(result.report.skippedTabs).toEqual([]);
    expect(result.report.unknownRows).toBe(0);
    expect(result.report.missingRows).toBe(0);
    expect(isNoopMerge(result)).toBe(true);
  });
});

describe("mergeFromSheet: push-only tabs", () => {
  const local = source();
  const base = buildBase(local, 1);

  it("completely ignores the cardio tab and creates no patches or collisions from it", () => {
    const remoteCardioRows: CellValue[][] = [
      ["ID", "Date", "Activity", "Duration (min)", "Distance", "Unit", "Note"],
      ["sess_c1", "2026-08-12", "Treadmill", 28, 5, "km", ""],
      ["sess_c2", "2026-08-13", "Rower", 20, 4, "km", ""],
    ];

    const result = mergeFromSheet(base, local, {
      [SHEET_TABS.cardio]: remoteCardioRows,
    });

    expect(isNoopMerge(result)).toBe(true);
    expect(result.setPatches).toHaveLength(0);
    expect(result.sessionPatches).toHaveLength(0);
    expect(result.dailyPatches).toHaveLength(0);
    expect(result.report.applied).toBe(0);
    expect(result.report.collisions).toHaveLength(0);
    expect(result.report.skippedTabs).not.toContain(SHEET_TABS.cardio);
    expect(result.report.unknownRows).toBe(0);
  });
});

describe("SyncBase typing", () => {
  it("is serialisable, since it is stored in IndexedDB as a meta row", () => {
    const base: SyncBase = buildBase(source(), 3);
    const roundTripped = JSON.parse(JSON.stringify(base)) as SyncBase;
    expect(roundTripped.revision).toBe(3);
    expect(roundTripped.dailyLogs["2026-08-12"].calories).toBe(2400);
  });
});

describe("real records satisfy SyncSource", () => {
  it("accepts the domain types without a cast", () => {
    const sets: WorkoutSet[] = [...source().sets];
    const sessions: WorkoutSession[] = [...source().sessions];
    const logs: DailyLog[] = [...source().dailyLogs];
    expect(buildBase(source({ sets, sessions, dailyLogs: logs }), 1).revision).toBe(1);
  });
});
