import { describe, expect, it } from "vitest";
import { dailyLogsToCsv, escapeCsvField, setsToCsv, toCsv, type ColumnSpec } from "../csv";
import type { DailyLog, Exercise, SplitSlot, WorkoutSession, WorkoutSet } from "../store";

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
