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
    expect(lines[1]).toBe('2026-08-12,14:30,Heavy Bench,Bench Press,main,225,lbs,5,8,"seat 4, pins 12"');
    expect(lines[2]).toBe('2026-08-12,14:35,Heavy Bench,"Chest Fly, Cable",accessory,50,lbs,10,,');
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
    // Row 1: absent carbs, fat, steps are empty cells
    expect(lines[1]).toBe("2026-08-10,2400,180,,,185.5,lbs,false");
    // Row 2: steps is 0 (logged zero), not empty cell, while calories/protein/carbs/fat/bodyweight are empty
    expect(lines[2]).toBe("2026-08-11,,,,,0,,lbs,");
    // Row 3: cheat day is true, numeric fields absent
    expect(lines[3]).toBe("2026-08-12,,,,,,,,lbs,true");
  });
});
