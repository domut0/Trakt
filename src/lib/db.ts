import Dexie, { type EntityTable } from "dexie";
import type { Food, FoodEntry, Meal, Recipe, RecipeIngredient } from "./food";
import type { PlannedWeek } from "./plan";
import type { SyncBase } from "./sync";
import type {
  BackupData,
  DailyLog,
  Exercise,
  Habit,
  HabitEntry,
  SplitSlot,
  TargetProfile,
  WorkoutSession,
  WorkoutSet,
} from "./store";

/**
 * IndexedDB persistence via Dexie.
 *
 * IMPORTANT: This module is safe to *import* during SSR (Dexie only opens the
 * database lazily, on first actual operation), but every exported function
 * here MUST only ever be *called* from client-side code (inside a useEffect,
 * an event handler, etc). IndexedDB does not exist in the SSR (Node) runtime,
 * and calling any of these during server render will throw.
 */

export type MetaKey = "settings" | "activeSession" | "syncConfig" | "syncBase" | "deviceId";

export interface SettingsMeta {
  key: "settings";
  unit: "lbs" | "kg";
  chartsEnabled?: boolean;
  /** Opt-in: daily calorie/macro/step targets. Off means the Today ring shows a
   * pure macro split, exactly as it did before targets existed. */
  targetsEnabled?: boolean;
  /** Opt-in: the habit checklist on Today. */
  habitsEnabled?: boolean;
  /** Opt-in: the plate and 1RM calculator sheets. */
  toolsEnabled?: boolean;
  /**
   * Named target profiles. Lives on the settings record rather than in its own
   * table because it is a handful of tiny rows that are always read together
   * with the rest of the settings, and never queried by anything but id.
   */
  targetProfiles?: TargetProfile[];
  /**
   * Which profile applies to each weekday, as 7 profile ids, MONDAY FIRST to
   * match the app's Monday-start week convention everywhere else. Resolve it
   * through `weekdayIndexFor` in targets.ts, never with a raw `getDay()`.
   */
  weekdayTargets?: string[];
  /** Opt-in: planning main lifts on a weekly template. */
  planEnabled?: boolean;
  /** Opt-in: food logging, meals and the food catalogue. */
  foodEnabled?: boolean;
  /**
   * The weekly training plan, as 7 entries, MONDAY FIRST for the same reason
   * `weekdayTargets` is. Resolve it through plan.ts, never with a raw
   * `getDay()`.
   *
   * Here on the settings record rather than in its own table, exactly like
   * `targetProfiles`: it is one small value that is always read with the rest of
   * settings and never queried. Being a non-indexed addition it also needs no
   * Dexie version bump (see the note on the version() calls below).
   *
   * Absent means the user has never planned anything, which is a different state
   * from a week of explicit rest days, and both must read as "no plan".
   */
  plannedWeek?: PlannedWeek;
}

export interface ActiveSessionMeta {
  key: "activeSession";
  activeSessionId?: string;
  currentExerciseId?: string;
  currentBlock?: {
    blockGroupId: string;
    targetSets: number;
    loggedInBlock: number;
    weight: number;
    reps: number;
    rpe?: number;
  };
}

/**
 * Identifies this install to the sync script.
 *
 * Its own row rather than a field on SyncConfigMeta, because it identifies the
 * BROWSER, not the connection. Held on the config row it died with every
 * disconnect, and reconnecting minted a new id that the sheet then refused --
 * so pasting a wrong URL once and retrying locked you out of your own sheet.
 *
 * Consequently it also survives `replaceAllData`: restoring a backup does not
 * make you a different browser.
 */
export interface DeviceIdMeta {
  key: "deviceId";
  deviceId: string;
}

/**
 * Google Sheets sync connection details.
 *
 * Deliberately its own meta row rather than a field on SettingsMeta, and
 * deliberately absent from BackupData. The url and secret together are a bearer
 * capability over the sheet, so putting them in an exportable JSON file would
 * mean sharing a backup hands over write access. Keeping them device-local also
 * makes the safe thing the default when a backup is restored onto a second
 * phone, which sync cannot support (see `deviceId`).
 */
export interface SyncConfigMeta {
  key: "syncConfig";
  /** The Apps Script web app /exec URL. */
  url: string;
  secret: string;
  /** Identifies this install to the script, which refuses a push from another. */
  deviceId: string;
  enabled: boolean;
  /** Filled in from the script's reply, so Settings can link to the sheet. */
  spreadsheetUrl?: string;
}

/**
 * The merge ancestor: exactly what was last successfully pushed.
 *
 * Held in its own row so `replaceAllData` can drop it without touching the
 * connection details, which is the asymmetry that matters -- restoring a backup
 * must forget what the sheet looked like, but must not disconnect the sheet.
 */
export interface SyncBaseMeta {
  key: "syncBase";
  base: SyncBase;
}

type MetaRecord = SettingsMeta | ActiveSessionMeta | SyncConfigMeta | SyncBaseMeta | DeviceIdMeta;

class WorkoutDb extends Dexie {
  exercises!: EntityTable<Exercise, "id">;
  slots!: EntityTable<SplitSlot, "id">;
  sessions!: EntityTable<WorkoutSession, "id">;
  sets!: EntityTable<WorkoutSet, "id">;
  meta!: EntityTable<MetaRecord, "key">;
  dailyLogs!: EntityTable<DailyLog, "date">;
  habits!: EntityTable<Habit, "id">;
  habitEntries!: EntityTable<HabitEntry, "id">;
  foods!: EntityTable<Food, "id">;
  foodEntries!: EntityTable<FoodEntry, "id">;
  meals!: EntityTable<Meal, "id">;
  recipes!: EntityTable<Recipe, "id">;
  recipeIngredients!: EntityTable<RecipeIngredient, "id">;

  constructor() {
    super("workout-tracker");
    this.version(1).stores({
      exercises: "id",
      slots: "id",
      sessions: "id",
      sets: "id, sessionId",
      meta: "key",
    });
    // v2 adds daily numeric logging. Only the NEW table is declared: Dexie
    // carries every table from the previous version forward untouched, and
    // adding a table needs no data migration, so an existing v1 database
    // upgrades in place with all workout data intact.
    this.version(2).stores({
      dailyLogs: "date",
    });
    // NO version(3) for cardio, deliberately. stores() declares only primary
    // keys and indexes, and every field cardio adds to a session (kind,
    // cardioExerciseId, durationMinutes, distance, setupNote) is non-indexed —
    // as is splitSlotId becoming optional. Dexie stores whole objects, so those
    // records round-trip through the v2 schema untouched. Bumping the version
    // here would cost an upgrade transaction on every existing install and buy
    // nothing. Only add version(3) if cardio ever needs a real INDEX.
    //
    // v3 adds habit tracking, which DOES need new tables (and so a real bump).
    // `habitEntries` is indexed on both `date` and `habitId`: Today reads a
    // whole day at once, while deleting a habit has to sweep every entry for
    // that habit across all history.
    //
    // Session notes arrived at the same time and are NOT reflected here, for the
    // same reason cardio was not: `note` is a non-indexed field on an existing
    // record, so it round-trips through the old schema untouched.
    this.version(3).stores({
      habits: "id",
      habitEntries: "id, date, habitId",
    });
    //
    // v4 adds food logging, which DOES need a real bump for the same reason v3
    // did: new tables with new indexes, not new fields on existing records.
    //
    // `foodEntries` is indexed on `date` because Today reads a whole day at
    // once, and on `mealId` because deleting a meal has to find every entry
    // that pointed at it. `foods` is indexed on `barcode` for scan lookup and
    // on `name` for the catalogue listing.
    //
    // Deliberately NOT indexed: the soft `foodId` on an entry. Nothing ever
    // queries entries by food, because nothing resolves an entry's macros by
    // looking its food back up -- the basis is frozen onto the entry itself.
    // Indexing it would advertise a relationship the design does not have.
    this.version(4).stores({
      foods: "id, barcode, name",
      foodEntries: "id, date, mealId",
      meals: "id",
      recipes: "id",
      recipeIngredients: "id, recipeId",
    });
  }
}

// Defining the Dexie class / instance at module load is safe — Dexie does not
// touch IndexedDB until the first query/transaction runs. Nothing in this
// module executes eagerly.
export const db = new WorkoutDb();

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** The id of the profile every weekday points at until the user splits them up. */
export const DEFAULT_TARGET_PROFILE_ID = "tp_default";

/**
 * A fresh set of target profiles: exactly one, applied to all seven days.
 *
 * A factory rather than a const because the result contains arrays that end up
 * in store state, and a shared frozen-by-convention literal is one careless
 * `.push` away from mutating every caller's copy.
 *
 * Targets ship pre-seeded even while `targetsEnabled` is false, so flipping the
 * toggle on lands the user in a usable editor instead of an empty screen.
 */
export function defaultTargets(): {
  targetProfiles: TargetProfile[];
  weekdayTargets: string[];
} {
  return {
    targetProfiles: [{ id: DEFAULT_TARGET_PROFILE_ID, name: "Every day" }],
    weekdayTargets: Array.from({ length: 7 }, () => DEFAULT_TARGET_PROFILE_ID),
  };
}

export function defaultSettings(): SettingsMeta {
  return {
    key: "settings",
    unit: "lbs",
    chartsEnabled: true,
    targetsEnabled: false,
    habitsEnabled: false,
    toolsEnabled: false,
    ...defaultTargets(),
  };
}

export const DEFAULT_SETTINGS: SettingsMeta = defaultSettings();

export const EMPTY_ACTIVE_SESSION: ActiveSessionMeta = {
  key: "activeSession",
};

export interface AllData {
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  dailyLogs: DailyLog[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  foods: Food[];
  foodEntries: FoodEntry[];
  meals: Meal[];
  recipes: Recipe[];
  recipeIngredients: RecipeIngredient[];
  settings: SettingsMeta;
  activeSession: ActiveSessionMeta;
}

/** Reads every table. Client-only. */
export async function loadAll(): Promise<AllData> {
  const [
    exercises,
    slots,
    sessions,
    sets,
    dailyLogs,
    habits,
    habitEntries,
    foods,
    foodEntries,
    meals,
    recipes,
    recipeIngredients,
    settingsMeta,
    activeSessionMeta,
  ] = await Promise.all([
    db.exercises.toArray(),
    db.slots.toArray(),
    db.sessions.toArray(),
    db.sets.toArray(),
    db.dailyLogs.toArray(),
    db.habits.toArray(),
    db.habitEntries.toArray(),
    db.foods.toArray(),
    db.foodEntries.toArray(),
    db.meals.toArray(),
    db.recipes.toArray(),
    db.recipeIngredients.toArray(),
    db.meta.get("settings"),
    db.meta.get("activeSession"),
  ]);
  // A settings record written before targets existed has no profiles at all.
  // Fill them in on read so nothing downstream has to cope with the empty case,
  // and so enabling targets later never lands on a profile-less screen.
  const stored = settingsMeta as SettingsMeta | undefined;
  const settings: SettingsMeta = stored
    ? {
        ...stored,
        ...(stored.targetProfiles?.length && stored.weekdayTargets?.length === 7
          ? {}
          : defaultTargets()),
      }
    : defaultSettings();
  return {
    exercises,
    slots,
    sessions,
    sets,
    dailyLogs,
    habits,
    habitEntries,
    foods,
    foodEntries,
    meals,
    recipes,
    recipeIngredients,
    settings,
    activeSession: (activeSessionMeta as ActiveSessionMeta) ?? EMPTY_ACTIVE_SESSION,
  };
}

/** True if the DB has never been seeded (all core tables empty). Client-only. */
export async function isDbEmpty(): Promise<boolean> {
  const count = await db.exercises.count();
  return count === 0;
}

/** One-time seed of the DB with the given data. Client-only. Idempotent callers should gate on isDbEmpty() first. */
export async function seedDb(data: {
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  settings: SettingsMeta;
}): Promise<void> {
  // dailyLogs, habits and habitEntries are in the transaction scope but
  // intentionally never written: a first run seeds no daily logs and no habits,
  // so those tables start empty. They are still listed because Dexie requires
  // every table a transaction MIGHT touch to be in scope, and clearing them is
  // part of the same atomic unit if this is ever extended.
  await db.transaction(
    "rw",
    [
      db.exercises,
      db.slots,
      db.sessions,
      db.sets,
      db.dailyLogs,
      db.habits,
      db.habitEntries,
      db.meta,
    ],
    async () => {
      await db.exercises.bulkPut(data.exercises);
      await db.slots.bulkPut(data.slots);
      await db.sessions.bulkPut(data.sessions);
      await db.sets.bulkPut(data.sets);
      await db.meta.put(data.settings);
      await db.meta.put(EMPTY_ACTIVE_SESSION);
    },
  );
}

/**
 * Full backup restore: replaces the entire dataset (exercises, slots,
 * sessions, sets, daily logs, settings) and clears any in-progress workout, in a single
 * Dexie transaction. Either everything lands or nothing does — a failure
 * partway through rolls the whole transaction back, so existing data is
 * never left half-overwritten. Client-only. Caller must have already fully
 * validated `data` (see `parseBackup` in store.ts) — this helper trusts its
 * input completely.
 */
export async function replaceAllData(data: BackupData): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.exercises,
      db.slots,
      db.sessions,
      db.sets,
      db.dailyLogs,
      db.habits,
      db.habitEntries,
      db.meta,
    ],
    async () => {
      await db.exercises.clear();
      await db.slots.clear();
      await db.sessions.clear();
      await db.sets.clear();
      await db.dailyLogs.clear();
      await db.habits.clear();
      await db.habitEntries.clear();
      await db.exercises.bulkPut(data.exercises);
      await db.slots.bulkPut(data.slots);
      await db.sessions.bulkPut(data.sessions);
      await db.sets.bulkPut(data.sets);
      await db.dailyLogs.bulkPut(data.dailyLogs);
      await db.habits.bulkPut(data.habits);
      await db.habitEntries.bulkPut(data.habitEntries);
      // Annotated as SettingsMeta rather than inlined: `meta` is a union table,
      // and an inline literal makes Dexie's InsertType resolve against the wrong
      // arm of the union, which is a type error even though the value is valid.
      const settings: SettingsMeta = {
        key: "settings",
        unit: data.unit,
        chartsEnabled: true,
        targetsEnabled: data.targetsEnabled,
        habitsEnabled: data.habitsEnabled,
        toolsEnabled: data.toolsEnabled,
        targetProfiles: data.targetProfiles,
        weekdayTargets: data.weekdayTargets,
        planEnabled: data.planEnabled,
        // Written straight through, `undefined` included: Dexie stores the
        // record without the key, which is precisely the "never planned" state
        // and is what `loadAll` reads back. Substituting a week of rest days
        // here would hand every importer a plan they never made.
        plannedWeek: data.plannedWeek,
      };
      await db.meta.put(settings);
      await db.meta.put(EMPTY_ACTIVE_SESSION);
      // The sync base describes a dataset that no longer exists, so it MUST go
      // with it. Left behind, the next sync diffs the incoming data against the
      // old base, reads every vanished record as "the user deleted this", and
      // wipes their sheet. That path is reachable from the Reset button, which
      // is documented as a clean slate for testing.
      //
      // syncConfig is a separate row and deliberately survives: restoring a
      // backup should not silently disconnect the sheet. Two rows is what makes
      // that asymmetry expressible.
      await db.meta.delete("syncBase");
    },
  );
}

// --- Sync meta ------------------------------------------------------------
//
// None of these go through `safeWrite`. That helper flips the global
// `writeFailed` flag, which raises "Couldn't save to this device" in
// WriteErrorBanner -- far too alarming for a sync bookkeeping write that the
// user's logging does not depend on. Callers handle their own failures.

export async function loadDeviceId(): Promise<string | undefined> {
  const record = (await db.meta.get("deviceId")) as DeviceIdMeta | undefined;
  return record?.deviceId;
}

export async function saveDeviceId(deviceId: string): Promise<void> {
  const record: DeviceIdMeta = { key: "deviceId", deviceId };
  await db.meta.put(record);
}

export async function loadSyncConfig(): Promise<SyncConfigMeta | undefined> {
  return (await db.meta.get("syncConfig")) as SyncConfigMeta | undefined;
}

export async function saveSyncConfig(config: SyncConfigMeta): Promise<void> {
  await db.meta.put(config);
}

export async function deleteSyncConfig(): Promise<void> {
  await db.meta.delete("syncConfig");
}

export async function loadSyncBase(): Promise<SyncBase | undefined> {
  const record = (await db.meta.get("syncBase")) as SyncBaseMeta | undefined;
  return record?.base;
}

export async function saveSyncBase(base: SyncBase): Promise<void> {
  const record: SyncBaseMeta = { key: "syncBase", base };
  await db.meta.put(record);
}

export async function clearSyncBase(): Promise<void> {
  await db.meta.delete("syncBase");
}

export async function putSettingsMeta(settings: SettingsMeta): Promise<void> {
  await db.meta.put(settings);
}

export async function putActiveSessionMeta(meta: ActiveSessionMeta): Promise<void> {
  await db.meta.put(meta);
}

// Set by store.ts at module scope so a failed write can surface as UI state
// (a banner) without db.ts importing store.ts back — store.ts already
// imports db.ts, and that import would be circular.
let writeErrorHandler: ((err: unknown) => void) | null = null;

export function setWriteErrorHandler(fn: ((err: unknown) => void) | null): void {
  writeErrorHandler = fn;
}

/**
 * Fire-and-forget a Dexie write without letting a DB failure crash the UI.
 * The in-memory Zustand state is already the source of truth for the current
 * render by the time this runs — this is only the durable mirror.
 *
 * Dexie's failure mode is inconsistent depending on the call site: some
 * operations throw synchronously (e.g. when the IndexedDB API is missing
 * entirely, as happens if this is ever invoked outside the browser), others
 * return a rejected promise. Both are handled here.
 */
export function safeWrite(op: () => Promise<unknown>): void {
  try {
    const result = op();
    Promise.resolve(result).catch((err: unknown) => {
      console.error("[db] write failed", err);
      writeErrorHandler?.(err);
    });
  } catch (err) {
    console.error("[db] write failed", err);
    writeErrorHandler?.(err);
  }
}
