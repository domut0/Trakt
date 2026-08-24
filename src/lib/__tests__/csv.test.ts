import { describe, expect, it } from "vitest";
import {
  cardioColumns,
  cardioSessionsInOrder,
  dailyLogsToCsv,
  escapeCsvField,
  foodEntriesInOrder,
  foodEntryColumns,
  habitEntriesInOrder,
  habitEntryColumns,
  sessionColumns,
  setsToCsv,
  strengthSessionsInOrder,
  toCsv,
  toRows,
  type ColumnSpec,
} from "../csv";
import type {
  DailyLog,
  Exercise,
  Habit,
  HabitEntry,
  SplitSlot,
  WorkoutSession,
  WorkoutSet,
} from "../store";
import type { FoodEntry, Meal } from "../food";

describe("escapeCsvField", () => {
  it("leaves plain text unquoted", () => {
    expect(escapeCsvField("Bench Press")).toBe("Bench Press");
    expect(escapeCsvField("12345")).toBe("12345");
  });

  it("wraps fields containing commas in double quotes", () => {
    expect(escapeCsvField("seat 4, pins 12")).toBe('"seat 4, pins 12"');
  });

  it("escapes internal double quotes by doubling them and wrapping in quotes", () => {
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""');
  });

  it("wraps fields containing newlines or carriage returns in quotes", () => {
    expect(escapeCsvField("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(escapeCsvField("line 1\r\nline 2")).toBe('"line 1\r\nline 2"');
  });

  it("handles fields containing commas, quotes, and newlines combined", () => {
    expect(escapeCsvField('note, "pins 12"\nnext line')).toBe('"note, ""pins 12""\nnext line"');
  });

  it("quotes a bare carriage return with no newline after it", () => {
    // Old-Mac line endings and stray \r from pasted text both land here. \r is
    // a quote trigger in its own right under RFC 4180, not only as part of CRLF.
    expect(escapeCsvField("seat 4\rpins 12")).toBe('"seat 4\rpins 12"');
  });

  it("doubles every quote in a field, not just the first", () => {
    expect(escapeCsvField('""')).toBe('""""""');
    expect(escapeCsvField('a"b"c')).toBe('"a""b""c"');
  });

  it("leaves a field containing a semicolon or tab unquoted", () => {
    // Only the four RFC 4180 triggers force quoting. Over-quoting is not
    // wrong output, but it is noise in every cell of a real export.
    expect(escapeCsvField("seat 4; pins 12")).toBe("seat 4; pins 12");
    expect(escapeCsvField("seat 4\tpins 12")).toBe("seat 4\tpins 12");
  });
});

describe("toCsv", () => {
  interface TestRow {
    name: string;
    score?: number;
    flag?: boolean;
    note?: string;
  }

  const columns: ColumnSpec<TestRow>[] = [
    { header: "Name", accessor: "name" },
    { header: "Score", accessor: "score" },
    { header: "Flag", accessor: "flag" },
    { header: "Note", accessor: (r) => r.note },
  ];

  it("outputs header row only when rows array is empty", () => {
    const csv = toCsv<TestRow>([], columns);
    expect(csv).toBe("Name,Score,Flag,Note");
  });

  it("uses CRLF (\\r\\n) line endings", () => {
    const rows: TestRow[] = [{ name: "Alice", score: 10 }];
    const csv = toCsv(rows, columns);
    expect(csv).toBe("Name,Score,Flag,Note\r\nAlice,10,,");
    expect(csv.includes("\r\n")).toBe(true);
  });

  it("treats undefined and null as empty cells, but keeps 0 and false", () => {
    const rows: TestRow[] = [
      { name: "Bob", score: 0, flag: false, note: undefined },
      { name: "Charlie", score: undefined, flag: true, note: "ok" },
    ];
    const csv = toCsv(rows, columns);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("Bob,0,false,");
    expect(lines[2]).toBe("Charlie,,true,ok");
  });
});

describe("setsToCsv", () => {
  const exercises: Exercise[] = [
    { id: "e_bench", name: "Bench Press", type: "main" },
    { id: "e_fly", name: "Chest Fly, Cable", type: "accessory" },
  ];

  const slots: SplitSlot[] = [{ id: "s_hb", name: "Heavy Bench", rotationOrder: 0 }];

  const timestamp = new Date(2026, 7, 12, 14, 30, 0).getTime();

  const sessions: WorkoutSession[] = [
    { id: "sess_1", splitSlotId: "s_hb", startedAt: timestamp, endedAt: timestamp + 3600_000 },
  ];

  const sets: WorkoutSet[] = [
    {
      id: "set_1",
      sessionId: "sess_1",
      exerciseId: "e_bench",
      weight: 225,
      reps: 5,
      rpe: 8,
      setupNote: "seat 4, pins 12",
      loggedAt: timestamp,
    },
    {
      id: "set_2",
      sessionId: "sess_1",
      exerciseId: "e_fly",
      weight: 50,
      reps: 10,
      loggedAt: timestamp + 300_000,
    },
  ];

  it("formats logged sets with expected headers and resolved slot/exercise names", () => {
    const csv = setsToCsv(sets, sessions, exercises, slots, "lbs");
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(
      "Date,Time,Split Slot,Exercise,Exercise Type,Weight,Unit,Reps,RPE,Setup Note",
    );
    expect(lines[1]).toBe(
      '2026-08-12,14:30,Heavy Bench,Bench Press,main,225,lbs,5,8,"seat 4, pins 12"',
    );
    expect(lines[2]).toBe('2026-08-12,14:35,Heavy Bench,"Chest Fly, Cable",accessory,50,lbs,10,,');
  });

  it("escapes a setup note carrying a comma, a quote, a CR and an LF all at once", () => {
    const note = 'seat 4, "high" pins\r\nbelt on\rno straps';
    const messySets: WorkoutSet[] = [{ ...sets[0], id: "set_messy", setupNote: note }];

    const csv = setsToCsv(messySets, sessions, exercises, slots, "lbs");
    // The escaped note spans lines, so the row cannot be found by splitting on
    // CRLF. Assert the whole payload instead: header, one CRLF, then the row.
    const expectedCell = '"seat 4, ""high"" pins\r\nbelt on\rno straps"';
    expect(csv).toBe(
      "Date,Time,Split Slot,Exercise,Exercise Type,Weight,Unit,Reps,RPE,Setup Note\r\n" +
        `2026-08-12,14:30,Heavy Bench,Bench Press,main,225,lbs,5,8,${expectedCell}`,
    );
    // Inner quotes doubled, outer quotes added exactly once.
    expect(csv.endsWith('no straps"')).toBe(true);
    expect(csv).not.toContain('"""high"""');
  });

  it("separates records with CRLF, not bare LF", () => {
    const csv = setsToCsv(sets, sessions, exercises, slots, "lbs");
    expect(csv.split("\r\n")).toHaveLength(3);
    // No LF anywhere that is not preceded by a CR.
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("orders rows chronologically by loggedAt regardless of input order", () => {
    const csv = setsToCsv([sets[1], sets[0]], sessions, exercises, slots, "lbs");
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("14:30");
    expect(lines[2]).toContain("14:35");
  });

  it("leaves Split Slot empty for a session with no slot and never invents one", () => {
    // A cardio session carries no splitSlotId at all. Cardio produces no sets,
    // so this is a defensive assertion rather than a reachable state - but it
    // pins down that a slot-less session resolves to an empty cell instead of
    // picking up whichever slot happens to be first in the list.
    const slotless: WorkoutSession[] = [{ id: "sess_1", startedAt: timestamp }];
    const lines = setsToCsv(sets, slotless, exercises, slots, "lbs").split("\r\n");
    expect(lines[1].split(",")[2]).toBe("");
    expect(lines[2].split(",")[2]).toBe("");
  });
});

describe("dailyLogsToCsv", () => {
  it("outputs empty cells for absent numeric fields and never converts undefined to 0", () => {
    const logs: DailyLog[] = [
      {
        date: "2026-08-10",
        calories: 2400,
        protein: 180,
        bodyweight: 185.5,
        isCheatDay: false,
      },
      {
        date: "2026-08-11",
        steps: 0,
      },
      {
        date: "2026-08-12",
        isCheatDay: true,
      },
    ];

    const csv = dailyLogsToCsv(logs, "lbs");
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(
      "Date,Calories,Protein (g),Carbs (g),Fat (g),Steps,Bodyweight,Unit,Cheat Day",
    );
    // Nine columns, so nine cells on every row. Asserted structurally as well
    // as literally: hand-counting commas in the literals below is exactly how
    // a fixture ends up short one empty cell and still looks right.
    const cellCount = lines[0].split(",").length;
    expect(cellCount).toBe(9);
    for (const line of lines) {
      expect(line.split(",")).toHaveLength(cellCount);
    }

    // Row 1: absent carbs, fat AND steps are three empty cells
    expect(lines[1]).toBe("2026-08-10,2400,180,,,,185.5,lbs,false");
    // Row 2: steps is 0 (logged zero), not empty cell, while calories/protein/carbs/fat/bodyweight are empty
    expect(lines[2]).toBe("2026-08-11,,,,,0,,lbs,");
    // Row 3: cheat day is true, numeric fields absent
    expect(lines[3]).toBe("2026-08-12,,,,,,,lbs,true");
  });

  it("sorts rows by date ascending regardless of input order", () => {
    const logs: DailyLog[] = [
      { date: "2026-08-12", steps: 3 },
      { date: "2026-08-10", steps: 1 },
      { date: "2026-08-11", steps: 2 },
    ];

    const lines = dailyLogsToCsv(logs, "lbs").split("\r\n");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
  });

  it("writes a logged 0 as 0 for every numeric field, never as an empty cell", () => {
    // The converse of the rule above, and the easy one to break while fixing
    // it: a day of 0 steps or 0 calories is a real record, not an absent one.
    const logs: DailyLog[] = [
      {
        date: "2026-08-10",
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        steps: 0,
        bodyweight: 0,
        isCheatDay: false,
      },
    ];

    const lines = dailyLogsToCsv(logs, "kg").split("\r\n");
    expect(lines[1]).toBe("2026-08-10,0,0,0,0,0,0,kg,false");
  });
});

describe("toRows", () => {
  interface Row {
    name: string;
    score?: number;
    flag?: boolean;
  }

  const columns: ColumnSpec<Row>[] = [
    { header: "Name", accessor: "name" },
    { header: "Score", accessor: "score" },
    { header: "Flag", accessor: (r) => r.flag },
  ];

  it("returns the header row followed by one array per record", () => {
    const rows = toRows([{ name: "a", score: 1, flag: true }], columns);
    expect(rows).toEqual([
      ["Name", "Score", "Flag"],
      ["a", 1, true],
    ]);
  });

  it("returns the header row alone for an empty input", () => {
    expect(toRows([], columns)).toEqual([["Name", "Score", "Flag"]]);
  });

  it("preserves cell TYPES rather than stringifying them", () => {
    // This is the whole reason toRows exists separately from toCsv: a number
    // that arrives in Sheets as the string "225" is not arithmetic-usable, and
    // every formula the user writes over the column silently breaks.
    const [, row] = toRows([{ name: "a", score: 225, flag: false }], columns);
    expect(typeof row[0]).toBe("string");
    expect(typeof row[1]).toBe("number");
    expect(typeof row[2]).toBe("boolean");
  });

  it("keeps absent values absent instead of coercing them to empty strings", () => {
    // toCsv flattens undefined to "" because CSV has no other option. toRows
    // must NOT, or the merge cannot tell a cleared cell from an untouched one.
    const [, row] = toRows([{ name: "a" }], columns);
    expect(row[1]).toBeUndefined();
    expect(row[2]).toBeUndefined();
  });

  it("feeds toCsv, so the two never disagree about column order", () => {
    const rows: Row[] = [{ name: "a", score: 1, flag: true }];
    const fromCsv = toCsv(rows, columns).split("\r\n")[0];
    expect(fromCsv).toBe(toRows(rows, columns)[0].join(","));
  });
});

describe("sheet-only column specs", () => {
  const t = new Date(2026, 7, 12, 14, 30, 0).getTime();

  const exercises: Exercise[] = [
    { id: "e_bench", name: "Bench Press", type: "main" },
    { id: "e_row", name: "Rowing Machine", type: "cardio" },
  ];
  const slots: SplitSlot[] = [{ id: "s_hb", name: "Heavy Bench", rotationOrder: 0 }];

  const strength: WorkoutSession = {
    id: "sess_1",
    splitSlotId: "s_hb",
    startedAt: t,
    endedAt: t + 3600_000,
    note: "felt flat",
  };
  const cardio: WorkoutSession = {
    id: "sess_2",
    kind: "cardio",
    cardioExerciseId: "e_row",
    startedAt: t + 7200_000,
    durationMinutes: 22,
    distance: 4.5,
  };
  const sets: WorkoutSet[] = [
    { id: "set_1", sessionId: "sess_1", exerciseId: "e_bench", weight: 225, reps: 5, loggedAt: t },
    { id: "set_2", sessionId: "sess_1", exerciseId: "e_bench", weight: 225, reps: 4, loggedAt: t },
  ];

  it("splits strength and cardio sessions into their own tables", () => {
    const all = [cardio, strength];
    expect(strengthSessionsInOrder(all).map((s) => s.id)).toEqual(["sess_1"]);
    expect(cardioSessionsInOrder(all).map((s) => s.id)).toEqual(["sess_2"]);
  });

  it("counts sets per session and computes duration from endedAt", () => {
    const [header, row] = toRows([strength], sessionColumns(slots, sets));
    expect(header).toEqual([
      "Date",
      "Split Slot",
      "Started",
      "Ended",
      "Duration (min)",
      "Sets",
      "Note",
    ]);
    expect(row).toEqual(["2026-08-12", "Heavy Bench", "14:30", "15:30", 60, 2, "felt flat"]);
  });

  it("leaves duration and ended empty for an in-progress session", () => {
    // Computing against Date.now() would make the sheet's contents depend on
    // when it was synced rather than on what happened.
    const live: WorkoutSession = { id: "sess_3", splitSlotId: "s_hb", startedAt: t };
    const [, row] = toRows([live], sessionColumns(slots, []));
    expect(row[3]).toBe("");
    expect(row[4]).toBeUndefined();
    expect(row[5]).toBe(0);
  });

  it("resolves the cardio exercise and labels the distance unit", () => {
    const [header, row] = toRows([cardio], cardioColumns(exercises, "lbs"));
    expect(header).toEqual([
      "Date",
      "Time",
      "Exercise",
      "Duration (min)",
      "Distance",
      "Distance Unit",
      "Setup Note",
      "Note",
    ]);
    expect(row).toEqual([
      "2026-08-12",
      "16:30",
      "Rowing Machine",
      22,
      4.5,
      "mi",
      undefined,
      undefined,
    ]);
  });

  it("labels cardio distance as km under kg", () => {
    const [, row] = toRows([cardio], cardioColumns(exercises, "kg"));
    expect(row[5]).toBe("km");
  });

  it("resolves habit names and orders entries by date then name", () => {
    const habits: Habit[] = [
      { id: "h_1", name: "Creatine", order: 0 },
      { id: "h_2", name: "Ashwagandha", order: 1, archived: true },
    ];
    const entries: HabitEntry[] = [
      { id: "2026-08-12|h_1", date: "2026-08-12", habitId: "h_1" },
      { id: "2026-08-12|h_2", date: "2026-08-12", habitId: "h_2" },
      { id: "2026-08-11|h_1", date: "2026-08-11", habitId: "h_1" },
    ];

    const ordered = habitEntriesInOrder(entries, habits);
    expect(ordered.map((e) => e.id)).toEqual([
      "2026-08-11|h_1",
      "2026-08-12|h_2",
      "2026-08-12|h_1",
    ]);

    const [header, ...rows] = toRows(ordered, habitEntryColumns(habits));
    expect(header).toEqual(["Date", "Habit", "Archived"]);
    // An archived habit keeps its entries so history stays honest; the flag is
    // how a reader tells "stopped tracking" from "stopped doing it".
    expect(rows[1]).toEqual(["2026-08-12", "Ashwagandha", true]);
    expect(rows[2]).toEqual(["2026-08-12", "Creatine", false]);
  });

  it("orders food entries by date, then meal rank, then loggedAt time", () => {
    const meals: Meal[] = [
      { id: "m_b", name: "Breakfast", fromMinutes: 300, toMinutes: 660, rank: 0 },
      { id: "m_l", name: "Lunch", fromMinutes: 660, toMinutes: 900, rank: 1 },
      { id: "m_d", name: "Dinner", fromMinutes: 1020, toMinutes: 1320, rank: 2 },
    ];

    const entries: FoodEntry[] = [
      {
        id: "fe_d1",
        date: "2026-08-12",
        mealId: "m_d",
        name: "Steak",
        quantity: 200,
        unit: "g",
        basisQuantity: 100,
        basisUnit: "g",
        calories: 250,
        loggedAt: 1000,
      },
      {
        id: "fe_b1",
        date: "2026-08-12",
        mealId: "m_b",
        name: "Eggs",
        quantity: 2,
        unit: "serving",
        basisQuantity: 1,
        basisUnit: "serving",
        calories: 70,
        loggedAt: 5000, // Logged later in wall-clock time, but belongs to Breakfast
      },
      {
        id: "fe_b2",
        date: "2026-08-12",
        mealId: "m_b",
        name: "Toast",
        quantity: 1,
        unit: "serving",
        basisQuantity: 1,
        basisUnit: "serving",
        calories: 80,
        loggedAt: 6000,
      },
      {
        id: "fe_prev",
        date: "2026-08-11",
        mealId: "m_l",
        name: "Rice",
        quantity: 150,
        unit: "g",
        basisQuantity: 100,
        basisUnit: "g",
        calories: 130,
        loggedAt: 7000,
      },
      {
        id: "fe_unknown",
        date: "2026-08-12",
        mealId: "m_deleted",
        name: "Snack",
        quantity: 1,
        unit: "serving",
        basisQuantity: 1,
        basisUnit: "serving",
        calories: 50,
        loggedAt: 2000,
      },
    ];

    const ordered = foodEntriesInOrder(entries, meals);
    expect(ordered.map((e) => e.id)).toEqual(["fe_prev", "fe_b1", "fe_b2", "fe_d1", "fe_unknown"]);
  });

  it("exports resolved food entry with numbers and sensible rounding", () => {
    const meals: Meal[] = [
      { id: "m_b", name: "Breakfast", fromMinutes: 300, toMinutes: 660, rank: 0 },
    ];

    const entry: FoodEntry = {
      id: "fe_1",
      date: "2026-08-12",
      mealId: "m_b",
      name: "Rice Cake",
      brand: "Quaker",
      quantity: 3,
      unit: "serving",
      basisQuantity: 1,
      basisUnit: "serving",
      servingLabel: "cake",
      calories: 34.667,
      protein: 0.667,
      carbs: 7.333,
      fat: 0.333,
      loggedAt: 1000,
    };

    const [header, row] = toRows([entry], foodEntryColumns(meals));

    expect(header).toEqual([
      "Date",
      "Meal",
      "Food",
      "Brand",
      "Portion",
      "Quantity",
      "Unit",
      "Calories",
      "Protein (g)",
      "Carbs (g)",
      "Fat (g)",
    ]);

    expect(row).toEqual([
      "2026-08-12",
      "Breakfast",
      "Rice Cake",
      "Quaker",
      "3 cake",
      3,
      "serving",
      104,
      2,
      22,
      1,
    ]);
  });

  it("exports blank macro cells for unresolvable entries and never writes zeros", () => {
    const meals: Meal[] = [
      { id: "m_b", name: "Breakfast", fromMinutes: 300, toMinutes: 660, rank: 0 },
    ];

    // A food known only per-serving with no servingWeight cannot resolve grams.
    const unresolvable: FoodEntry = {
      id: "fe_unres",
      date: "2026-08-12",
      mealId: "m_b",
      name: "Unknown Weight Item",
      quantity: 100,
      unit: "g",
      basisQuantity: 1,
      basisUnit: "serving",
      calories: 200,
      protein: 10,
      carbs: 20,
      fat: 5,
      loggedAt: 1000,
    };

    const [, row] = toRows([unresolvable], foodEntryColumns(meals));

    // Raw inputs and portion survive, but macros must be undefined (blank cell), not 0.
    expect(row[0]).toBe("2026-08-12");
    expect(row[1]).toBe("Breakfast");
    expect(row[2]).toBe("Unknown Weight Item");
    expect(row[3]).toBeUndefined();
    expect(row[4]).toBe("100 g");
    expect(row[5]).toBe(100);
    expect(row[6]).toBe("g");
    expect(row[7]).toBeUndefined();
    expect(row[8]).toBeUndefined();
    expect(row[9]).toBeUndefined();
    expect(row[10]).toBeUndefined();
  });

  it("exports fallback meal label for deleted meals without dropping the row", () => {
    const meals: Meal[] = [
      { id: "m_b", name: "Breakfast", fromMinutes: 300, toMinutes: 660, rank: 0 },
    ];

    const orphanEntry: FoodEntry = {
      id: "fe_orphan",
      date: "2026-08-12",
      mealId: "m_deleted_meal_id",
      name: "Black Coffee",
      quantity: 1,
      unit: "serving",
      basisQuantity: 1,
      basisUnit: "serving",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      loggedAt: 1000,
    };

    const [, row] = toRows([orphanEntry], foodEntryColumns(meals));

    expect(row[1]).toBe("Meal");
    expect(row[2]).toBe("Black Coffee");
    // Logged zeros for macros stay as 0, not blank.
    expect(row[7]).toBe(0);
    expect(row[8]).toBe(0);
    expect(row[9]).toBe(0);
    expect(row[10]).toBe(0);
  });
});
