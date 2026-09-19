import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

// Its own file, for the reason db.upgrade.v5.test.ts explains at length: `db` is
// a module-level singleton and fake-indexeddb gives one IndexedDB per test FILE,
// so the moment any test calls db.open() the database is at the current version
// for every test after it. One upgrade-from-scratch claim per file is the only
// arrangement that holds.

const CURRENT_SCHEMA_VERSION = 7;

/** The v5 schema, which is what every install carrying the weekly-template
 *  planning model is sitting on. */
function openV5() {
  const v5 = new Dexie("workout-tracker");
  v5.version(5).stores({
    exercises: "id",
    slots: "id",
    sessions: "id",
    sets: "id, sessionId",
    meta: "key",
    dailyLogs: "date",
  });
  return v5;
}

describe("Dexie v5 -> v6: the weekly template becomes a timeline and a rotation", () => {
  it("migrates the single target profile into a phase, and the planned week onto the slots", async () => {
    const v5 = openV5();
    await v5.open();

    await v5.table("exercises").put({ id: "e_bench", name: "Bench Press", type: "main" });
    await v5.table("exercises").put({ id: "e_row", name: "Barbell Row", type: "accessory" });
    await v5.table("exercises").put({ id: "e_squat", name: "Back Squat", type: "main" });
    await v5.table("slots").put({ id: "s_upper", name: "Upper", rotationOrder: 0 });
    await v5.table("slots").put({ id: "s_lower", name: "Lower", rotationOrder: 1 });
    await v5.table("dailyLogs").put({ date: "2026-09-01", calories: 3100 });

    await v5.table("meta").put({
      key: "settings",
      unit: "kg",
      targetProfiles: [
        { id: "tp_default", name: "Every day", calories: 3400, protein: 210, steps: 20000 },
      ],
      weekdayTargets: Array.from({ length: 7 }, () => "tp_default"),
      // Two planned days naming the two slots. The second is deliberately cased
      // differently from the slot it belongs to: startWorkout matches slot names
      // case-insensitively and whitespace-trimmed, so the migration has to as
      // well, or a plan written as "lower" strands its exercises.
      plannedWeek: [
        { name: "Upper", exerciseIds: ["e_bench", "e_row"] },
        { name: "  lower  ", exerciseIds: ["e_squat"] },
        null,
        null,
        null,
        null,
        null,
      ],
    });
    v5.close();

    await db.open();
    expect(db.verno).toBe(CURRENT_SCHEMA_VERSION);

    // --- nutrition: one phase, in force forever -----------------------------
    const phases = await db.nutritionPhases.toArray();
    expect(phases).toHaveLength(1);
    expect(phases[0]).toMatchObject({
      kind: "targets",
      calories: 3400,
      protein: 210,
      steps: 20000,
    });
    // Dated to the epoch, NOT to today. A phase starting today would leave every
    // day of existing history resolving to "no targets", silently rewriting what
    // each past day had been measured against.
    expect(phases[0].startsOn).toBe("1970-01-01");

    // --- training: the lifts land on the slots ------------------------------
    const upper = await db.slots.get("s_upper");
    const lower = await db.slots.get("s_lower");
    expect(upper?.plannedExerciseIds).toEqual(["e_bench", "e_row"]);
    // The case-and-whitespace case: "  lower  " found the slot called "Lower".
    expect(lower?.plannedExerciseIds).toEqual(["e_squat"]);

    // --- the settings row keeps only what it still describes ----------------
    const settings = (await db.meta.get("settings")) as unknown as Record<string, unknown>;
    expect(settings.unit).toBe("kg");
    expect("targetProfiles" in settings).toBe(false);
    expect("weekdayTargets" in settings).toBe(false);
    expect("plannedWeek" in settings).toBe(false);

    // --- nothing else moved -------------------------------------------------
    expect(await db.dailyLogs.get("2026-09-01")).toMatchObject({ calories: 3100 });

    await useStore.getState().hydrate();
    const state = useStore.getState();
    expect(state.unit).toBe("kg");
    expect(state.nutritionPhases).toHaveLength(1);
    expect(state.plannedDays).toEqual([]);
    expect(state.slots.find((s) => s.id === "s_upper")?.plannedExerciseIds).toEqual([
      "e_bench",
      "e_row",
    ]);
  });
});
