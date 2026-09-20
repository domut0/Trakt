import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { useStore } from "../store";

// Its own file, deliberately, and not merged into db.upgrade.test.ts.
//
// `db` is a module-level singleton and fake-indexeddb gives each test FILE one
// IndexedDB, shared by every test in it. The moment any test in a file calls
// db.open(), the database is at the current version for the rest of that file,
// so a later test cannot construct an older one to upgrade from: Dexie sees the
// declared-but-missing tables, takes its SchemaDiff path, and helpfully
// RE-CREATES exactly the stores this test exists to prove were deleted. It
// passes as a false negative that looks like a real migration bug.
//
// One upgrade-from-scratch claim per file is the only arrangement that holds.

/** The tables v5 deletes, when the app stopped being a food tracker. */
const TABLES_DROPPED_BY_V5 = [
  "habits",
  "habitEntries",
  "foods",
  "foodEntries",
  "meals",
  "recipes",
  "recipeIngredients",
] as const;

const CURRENT_SCHEMA_VERSION = 9;

describe("Dexie v4 -> v5: the food and habit tables are dropped", () => {
  it("deletes the food and habit stores while leaving training data untouched", async () => {
    // A v4 database, which is what every install that ever had food logging is
    // sitting on. Declared in one version() call rather than four, because what
    // matters here is the shape on disk at the moment v5 opens it, not the route
    // it took to get there.
    const v4 = new Dexie("workout-tracker");
    v4.version(4).stores({
      exercises: "id",
      slots: "id",
      sessions: "id",
      sets: "id, sessionId",
      meta: "key",
      dailyLogs: "date",
      habits: "id",
      habitEntries: "id, date, habitId",
      foods: "id, barcode, name",
      foodEntries: "id, date, mealId",
      meals: "id",
      recipes: "id",
      recipeIngredients: "id, recipeId",
    });
    await v4.open();
    expect(v4.verno).toBe(4);

    await v4.table("exercises").put({ id: "e1", name: "Squat", type: "main" });
    await v4.table("slots").put({ id: "s1", name: "Heavy Squat", rotationOrder: 0 });
    await v4.table("sessions").put({ id: "sess1", splitSlotId: "s1", startedAt: 1000 });
    await v4
      .table("sets")
      .put({ id: "set1", sessionId: "sess1", exerciseId: "e1", weight: 315, reps: 3, loggedAt: 1 });
    // The day carries BOTH typed macros and, separately, food entries. Only the
    // typed ones are meant to survive, and they are the ones the app now reads.
    await v4.table("dailyLogs").put({ date: "2026-08-07", calories: 2400, bodyweight: 181.2 });
    // Three shapes, because the rename has to handle all of them: a day flagged
    // under the old name, a day carrying the old name set to false, and a day
    // that never had the key at all.
    await v4.table("dailyLogs").put({ date: "2026-08-08", isCheatDay: true });
    await v4.table("dailyLogs").put({ date: "2026-08-09", calories: 2100, isCheatDay: false });
    await v4.table("habits").put({ id: "h1", name: "Creatine", order: 0 });
    await v4.table("habitEntries").put({ id: "2026-08-07|h1", date: "2026-08-07", habitId: "h1" });
    await v4.table("meals").put({ id: "m1", name: "Breakfast", fromMinutes: 300, toMinutes: 660 });
    await v4.table("foods").put({ id: "f1", name: "Kimchi", basisQuantity: 100, basisUnit: "g" });
    await v4
      .table("foodEntries")
      .put({ id: "fe1", date: "2026-08-07", mealId: "m1", name: "Kimchi", calories: 35 });
    await v4.table("recipes").put({ id: "r1", name: "Overnight oats", servings: 2 });
    await v4.table("recipeIngredients").put({ id: "ri1", recipeId: "r1", foodId: "f1" });

    const storesBefore = Array.from(v4.backendDB().objectStoreNames);
    for (const name of TABLES_DROPPED_BY_V5) {
      expect(storesBefore).toContain(name);
    }
    v4.close();

    await db.open();
    expect(db.verno).toBe(CURRENT_SCHEMA_VERSION);

    // The point of the whole migration: gone from disk, not merely unreferenced.
    const persistedStores = Array.from(db.backendDB().objectStoreNames);
    for (const name of TABLES_DROPPED_BY_V5) {
      expect(persistedStores).not.toContain(name);
    }

    // Everything the app still reads came through intact. A migration that
    // dropped a table is only correct if it dropped exactly the tables it meant
    // to, and this is the half of that claim that costs real data to get wrong.
    expect(await db.exercises.get("e1")).toMatchObject({ name: "Squat" });
    expect(await db.sets.count()).toBe(1);
    expect(await db.dailyLogs.get("2026-08-07")).toMatchObject({
      calories: 2400,
      bodyweight: 181.2,
    });

    // v5 renamed isCheatDay to isUntracked; v9 deleted the field outright.
    // This opens at the CURRENT schema, so both run, and what a v4 database
    // arrives with is a row carrying NEITHER key. Dexie stores whole objects,
    // so an upgrade that skipped a row would leave the old key on it forever -
    // which is the thing worth asserting, in both directions.
    const flagged = (await db.dailyLogs.get("2026-08-08")) as unknown as Record<string, unknown>;
    expect("isUntracked" in flagged).toBe(false);
    expect("isCheatDay" in flagged).toBe(false);

    const notFlagged = (await db.dailyLogs.get("2026-08-09")) as unknown as Record<string, unknown>;
    expect("isUntracked" in notFlagged).toBe(false);
    expect("isCheatDay" in notFlagged).toBe(false);
    // The numbers the day actually recorded are untouched by any of it.
    expect(notFlagged.calories).toBe(2100);

    await useStore.getState().hydrate();
    const state = useStore.getState();
    expect(state.exercises).toHaveLength(1);
    expect(state.sets).toHaveLength(1);
    // Sorted, because hydrate reads the table and Dexie returns primary-key
    // order; asserting the whole array is what catches a migration that dropped
    // or duplicated a row rather than merely mis-renaming a key.
    expect([...state.dailyLogs].sort((a, b) => a.date.localeCompare(b.date))).toEqual([
      { date: "2026-08-07", calories: 2400, bodyweight: 181.2 },
      // The row that was a cheat day, then an untracked day, and is now a day
      // with nothing on it - which is what it always recorded. The ROW survives
      // rather than being deleted: stripping a field is not licence to throw
      // away the day it was attached to, and a stored empty row is only pruned
      // when the user next writes to that day.
      { date: "2026-08-08" },
      { date: "2026-08-09", calories: 2100 },
    ]);
  });
});
