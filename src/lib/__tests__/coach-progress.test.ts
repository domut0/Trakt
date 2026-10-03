import { describe, expect, it } from "vitest";
import { progressDays, progressValue, progressWeeks, shiftProgressAnchor } from "../coach-progress";
import type { ClientSnapshot } from "../client-snapshot";

describe("coach progress calendar", () => {
  it("keeps seven columns and one row per week, including partial month edges", () => {
    expect(progressWeeks("2026-09-27", "week")).toEqual([
      [
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
        "2026-09-26",
        "2026-09-27",
      ],
    ]);
    expect(progressWeeks("2026-09-27", "fortnight")).toHaveLength(2);
    const month = progressWeeks("2026-09-27", "month");
    expect(month).toHaveLength(5);
    expect(month.every((row) => row.length === 7)).toBe(true);
    expect(month[0][0]).toBeNull();
    expect(month.at(-1)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      null,
      null,
      null,
      null,
    ]);
    expect(month.flat().filter(Boolean)).toHaveLength(30);
  });

  it("moves through months without skipping February from a 31st anchor", () => {
    expect(shiftProgressAnchor("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(progressWeeks("2024-02-29", "month").flat()).toContain("2024-02-29");
    expect(progressWeeks("2026-03-08", "fortnight").flat().filter(Boolean)).toHaveLength(14);
  });

  it("shows a recorded zero separately from a missing number", () => {
    expect(progressValue(0)).toBe("0");
    expect(progressValue(undefined)).toBe("–");
    expect(progressValue(182.35, true)).toBe("182.3");
  });

  it("includes actual workout sets and multiple cardio entries, but not unfinished workouts", () => {
    const startedAt = new Date(2026, 8, 21, 7).getTime();
    const snapshot: ClientSnapshot = {
      unit: "kg",
      exercises: [
        { id: "squat", name: "Squat", type: "main" },
        { id: "bike", name: "Bike", type: "cardio" },
      ],
      slots: [{ id: "lower", name: "Lower body", rotationOrder: 0 }],
      dailyLogs: [{ date: "2026-09-21", steps: 0, protein: 150 }],
      sessions: [
        { id: "lift", splitSlotId: "lower", startedAt, endedAt: startedAt + 60_000 },
        { id: "unfinished", startedAt },
        {
          id: "cardio",
          kind: "cardio",
          cardioExerciseId: "bike",
          startedAt,
          endedAt: startedAt + 20 * 60_000,
          durationMinutes: 20,
          distance: 5,
        },
        { id: "second-cardio", kind: "cardio", startedAt, endedAt: startedAt, durationMinutes: 0 },
      ],
      sets: [
        {
          id: "set",
          sessionId: "lift",
          exerciseId: "squat",
          weight: 100,
          reps: 5,
          rpe: 8,
          loggedAt: startedAt,
        },
      ],
      nutritionPhases: [],
      plannedDays: [],
    };
    const before = JSON.stringify(snapshot);
    const day = progressDays(snapshot).get("2026-09-21")!;
    expect(day.log?.steps).toBe(0);
    expect(day.log?.calories).toBeUndefined();
    expect(day.workouts).toHaveLength(1);
    expect(day.workouts[0]).toMatchObject({
      name: "Lower body",
      sets: 1,
      details: ["Squat: 100 kg × 5 · RPE 8"],
    });
    expect(day.cardio).toHaveLength(2);
    expect(day.cardio[1].durationMinutes).toBe(0);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
