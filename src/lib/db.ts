import Dexie, { type EntityTable } from "dexie";
import type { SyncBase } from "./sync";
import type { NutritionPhase, PlannedDay } from "./planning";
import type {
  BackupData,
  DailyLog,
  Exercise,
  SplitSlot,
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
  /**
   * Which split card comes next.
   *
   * On the settings row rather than in its own table because it is exactly one
   * short string, always read with the rest of settings and never queried. Being
   * a non-indexed addition it needs no Dexie version bump either.
   */
  nextSlotId?: string;
  /**
   * The day the current REST card became current, as a day key.
   *
   * Beside the cursor because it is part of the same fact: where you are in the
   * split, and - when that is a rest - when you got there. A rest is the only
   * card the clock can spend, so this is what makes "that rest day is over"
   * answerable the next time the app opens. Non-indexed, so no version bump.
   */
  restSince?: string;
  /**
   * When the coach plan currently in force was issued, as its ISO instant.
   *
   * Held here rather than beside the sync config because it describes the app's
   * own plan -- which coach plan has been absorbed -- and must survive a
   * disconnect and reconnect of the sheet. Without it, reconnecting would
   * re-offer a plan the client accepted weeks ago. Non-indexed, so no version
   * bump.
   */
  lastAcceptedPlanAt?: string;
  /**
   * Whether a coach manages this person's plan. Set by accepting a coach's
   * plan, cleared only by unlinking. While set, the Plan tab is read-only and
   * the store refuses plan edits. Non-indexed, so no version bump.
   */
  coachManaged?: boolean;
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
  /**
   * How the sheet is reached. Only `"google"` syncs.
   *
   * A record with no `kind` was written by the Apps Script setup, which this
   * version no longer speaks. It is kept, not migrated or deleted: Settings
   * reads it to offer a reconnect, and the person's old sheet is still theirs.
   */
  kind?: "appsScript" | "google";
  /** The spreadsheet this app created and holds a grant on. */
  spreadsheetId?: string;
  /** Legacy, from the Apps Script setup: its /exec URL and secret. */
  url: string;
  secret: string;
  /** This install, kept across reconnects so a reset is not a new browser. */
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

/**
 * A client whose sheet this install can read, in coach mode.
 *
 * Pointers only. No client health data is stored here -- a client's log is
 * pulled into memory when their view is opened and dropped when it is closed,
 * which is the whole reason this feature needs no database to protect. What a
 * coach's device holds about a client is how to reach their spreadsheet, plus
 * the name to show it under.
 *
 */
export interface CoachClient {
  id: string;
  /** What the coach calls them. Shown in the banner and the client list. */
  name: string;
  /** Only "google" now. Kept so a client saved by an older version still reads. */
  kind: "google" | "appsScript";
  /** The spreadsheet this app was granted access to via the Picker. */
  spreadsheetId?: string;
  /** When their data was last pulled, so the banner can say how stale it is. */
  lastPulledAt?: number;
}

class WorkoutDb extends Dexie {
  exercises!: EntityTable<Exercise, "id">;
  slots!: EntityTable<SplitSlot, "id">;
  sessions!: EntityTable<WorkoutSession, "id">;
  sets!: EntityTable<WorkoutSet, "id">;
  meta!: EntityTable<MetaRecord, "key">;
  dailyLogs!: EntityTable<DailyLog, "date">;
  nutritionPhases!: EntityTable<NutritionPhase, "id">;
  plannedDays!: EntityTable<PlannedDay, "date">;
  coachClients!: EntityTable<CoachClient, "id">;

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

    // v5 deletes the food and habit tables. The app stopped being a food
    // tracker: calories and macros are now typed once at the end of the day
    // onto the dailyLogs row that already held bodyweight and steps, so nothing
    // reads a FoodEntry, a Meal or a Recipe any more. Declaring a table as null
    // is how Dexie drops it, and dropping is right rather than merely orphaning
    // it -- an unreferenced table keeps its whole index and its storage quota
    // forever, on a phone, for data no screen can reach.
    this.version(5)
      .stores({
        habits: null,
        habitEntries: null,
        foods: null,
        foodEntries: null,
        meals: null,
        recipes: null,
        recipeIngredients: null,
      })
      // The same bump renames DailyLog.isCheatDay to isUntracked, because the
      // flag stopped being a claim about food and became a claim about logging:
      // a day you CHOSE not to record is not a day you forgot, and only the
      // second one is a gap worth chasing. "Cheat day" was also a moralising
      // word for a mechanical fact.
      //
      // A rename is a data migration even though the field is non-indexed:
      // Dexie stores whole objects, so an untouched row keeps the old key
      // forever and every untracked day the user has already marked would
      // quietly revert to ordinary. This is the only place that can fix it,
      // because there is no other pass over every row.
      .upgrade(async (tx) => {
        await tx
          .table("dailyLogs")
          .toCollection()
          .modify((log: Record<string, unknown>) => {
            if (log.isCheatDay === undefined) return;
            if (log.isCheatDay === true) log.isUntracked = true;
            delete log.isCheatDay;
          });
      });

    // v6 replaces the weekly planning model with two of them, because there
    // were always two shapes in there fighting each other.
    //
    // NUTRITION IS A CALENDAR: `nutritionPhases` is a timeline of change-points
    // with no end dates, so "cutting from Sunday onward" is one row that covers
    // every day after it. It replaces `targetProfiles` + `weekdayTargets`,
    // which could only say "Tuesdays look like this".
    //
    // TRAINING IS A ROTATION: the planned lifts move onto the split slot, which
    // is the only place they can live for a split like UL×infinity - that
    // advances when you train, not when the date changes, so it has no weekday
    // to hang anything on. `plannedDays` is the escape hatch for the days you
    // genuinely do know in advance.
    //
    // `startsOn` is indexed because resolving any date means finding the latest
    // phase at or before it, which is the single most-called query in the app
    // once this ships. `plannedDays` is keyed by date: one pin per day, by
    // construction rather than by a uniqueness check somebody has to remember.
    this.version(6)
      .stores({
        nutritionPhases: "id, startsOn",
        plannedDays: "date",
      })
      .upgrade(async (tx) => {
        const meta = await tx.table("meta").get("settings");
        if (!meta) return;

        // The single surviving target profile becomes the phase that has always
        // been in force. Dated to the epoch rather than to today on purpose: a
        // phase starting today would leave every day of existing history
        // resolving to "no targets", which would silently rewrite what every
        // past day was measured against.
        const profiles = meta.targetProfiles as
          | {
              calories?: number;
              protein?: number;
              carbs?: number;
              fat?: number;
              steps?: number;
              name?: string;
            }[]
          | undefined;
        const first = profiles?.[0];
        const hasNumbers =
          first &&
          (first.calories !== undefined ||
            first.protein !== undefined ||
            first.carbs !== undefined ||
            first.fat !== undefined ||
            first.steps !== undefined);
        if (hasNumbers) {
          await tx.table("nutritionPhases").put({
            id: "np_migrated",
            startsOn: "1970-01-01",
            name: first.name && first.name !== "Every day" ? first.name : "Targets",
            kind: "targets",
            ...(first.calories !== undefined ? { calories: first.calories } : {}),
            ...(first.protein !== undefined ? { protein: first.protein } : {}),
            ...(first.carbs !== undefined ? { carbs: first.carbs } : {}),
            ...(first.fat !== undefined ? { fat: first.fat } : {}),
            ...(first.steps !== undefined ? { steps: first.steps } : {}),
          });
        }

        // Each planned weekday's lifts merge onto the slot of the same name.
        // Matched case-insensitively and whitespace-trimmed, the same rule
        // startWorkout uses, so a plan written as "heavy bench" still finds the
        // slot called "Heavy Bench" instead of stranding its exercises.
        const week = meta.plannedWeek as
          ({ name?: string; exerciseIds?: string[] } | null)[] | undefined;
        if (Array.isArray(week)) {
          const slots = await tx.table("slots").toArray();
          const byName = new Map(
            slots.map((sl: { id: string; name: string }) => [sl.name.trim().toLowerCase(), sl]),
          );
          const merged = new Map<string, Set<string>>();
          for (const day of week) {
            if (!day?.name || !Array.isArray(day.exerciseIds)) continue;
            const slot = byName.get(day.name.trim().toLowerCase());
            if (!slot) continue;
            const set = merged.get(slot.id) ?? new Set<string>();
            for (const id of day.exerciseIds) set.add(id);
            merged.set(slot.id, set);
          }
          for (const [slotId, ids] of merged) {
            const slot = slots.find((sl: { id: string }) => sl.id === slotId);
            if (slot) {
              await tx.table("slots").put({ ...slot, plannedExerciseIds: [...ids] });
            }
          }
        }

        // The settings record keeps only what it still describes.
        await tx.table("meta").put({ key: "settings", unit: meta.unit ?? "lbs" });
      });

    // v7 adds coach mode's client list, which is a genuine new table and so a
    // genuine bump -- unlike `lastAcceptedPlanAt`, which arrived at the same
    // time as a non-indexed field on the settings row and needed none.
    //
    // No secondary index. The list is read whole, every time, and a coach with
    // enough clients for an index to matter has outgrown a phone-local list.
    //
    // No upgrade function: a new table starts empty, and there is nothing in any
    // earlier version to migrate from.
    this.version(7).stores({
      coachClients: "id",
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

export function defaultSettings(): SettingsMeta {
  return { key: "settings", unit: "lbs" };
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
  nutritionPhases: NutritionPhase[];
  plannedDays: PlannedDay[];
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
    nutritionPhases,
    plannedDays,
    settingsMeta,
    activeSessionMeta,
  ] = await Promise.all([
    db.exercises.toArray(),
    db.slots.toArray(),
    db.sessions.toArray(),
    db.sets.toArray(),
    db.dailyLogs.toArray(),
    db.nutritionPhases.toArray(),
    db.plannedDays.toArray(),
    db.meta.get("settings"),
    db.meta.get("activeSession"),
  ]);
  // Nothing to backfill. Settings is two fields now - targets moved to their
  // own table as a timeline - so a record written before any of this simply
  // reads as itself.
  const stored = settingsMeta as SettingsMeta | undefined;
  const settings: SettingsMeta = stored ?? defaultSettings();
  return {
    exercises,
    slots,
    sessions,
    sets,
    dailyLogs,
    nutritionPhases,
    plannedDays,
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
  assertWritable("seedDb");
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
      db.nutritionPhases,
      db.plannedDays,
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
  assertWritable("replaceAllData");
  await db.transaction(
    "rw",
    [
      db.exercises,
      db.slots,
      db.sessions,
      db.sets,
      db.dailyLogs,
      db.nutritionPhases,
      db.plannedDays,
      db.meta,
    ],
    async () => {
      await db.exercises.clear();
      await db.slots.clear();
      await db.sessions.clear();
      await db.sets.clear();
      await db.dailyLogs.clear();
      await db.nutritionPhases.clear();
      await db.plannedDays.clear();
      await db.exercises.bulkPut(data.exercises);
      await db.slots.bulkPut(data.slots);
      await db.sessions.bulkPut(data.sessions);
      await db.sets.bulkPut(data.sets);
      await db.dailyLogs.bulkPut(data.dailyLogs);
      await db.nutritionPhases.bulkPut(data.nutritionPhases);
      await db.plannedDays.bulkPut(data.plannedDays);
      // Annotated as SettingsMeta rather than inlined: `meta` is a union table,
      // and an inline literal makes Dexie's InsertType resolve against the wrong
      // arm of the union, which is a type error even though the value is valid.
      const settings: SettingsMeta = {
        key: "settings",
        unit: data.unit,
        nextSlotId: data.nextSlotId,
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

// --- Coach mode -----------------------------------------------------------
//
// Like the sync meta below, these do NOT go through `safeWrite`: it flips the
// global write-failure flag, which raises "Couldn't save to this device" -- far
// too alarming for bookkeeping about somebody else's spreadsheet. Callers
// handle their own failures.
//
// They are also exempt from the read-only latch on purpose. The latch protects
// the coach's own training data while a client's is on screen; adding or
// renaming a client is not that, and would otherwise be impossible to do from
// inside the very mode it belongs to.

export async function loadCoachClients(): Promise<CoachClient[]> {
  return db.coachClients.toArray();
}

export async function saveCoachClient(client: CoachClient): Promise<void> {
  await db.coachClients.put(client);
}

export async function deleteCoachClient(id: string): Promise<void> {
  await db.coachClients.delete(id);
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

/**
 * Why every durable write in the app can be switched off.
 *
 * Coach mode renders another person's data through this app's own screens, and
 * it does that by swapping the arrays in the Zustand store — which is what makes
 * Today, Charts and History work unmodified for a client. The cost of that trick
 * is that the store's ~33 write-through call sites are still wired to THIS
 * device's database. A single action that slips past a disabled control would
 * write the client's data into the coach's own log.
 *
 * That failure is quiet, which is what makes it serious. Nothing throws, nothing
 * renders wrong, and the coach finds out weeks later that their own training
 * history has a fortnight of somebody else's numbers in it.
 *
 * Disabling the controls is not the guarantee, because it relies on every future
 * screen remembering to. This is the guarantee: one latch at the single
 * chokepoint every write already passes through, so the safe behaviour is the
 * default for code that has not been written yet.
 *
 * `reason` is a human-readable string rather than a boolean so that anything
 * reporting a refused write can say WHY it was refused.
 */
let readOnlyReason: string | undefined;

export function setDbReadOnly(reason: string | undefined): void {
  readOnlyReason = reason;
}

/** The reason writes are currently refused, or undefined when they are allowed. */
export function dbReadOnlyReason(): string | undefined {
  return readOnlyReason;
}

/**
 * Guard for the destructive writes that do NOT go through `safeWrite`.
 *
 * `replaceAllData` and `seedDb` are awaited by their callers rather than
 * fire-and-forget, and they clear every table before writing. A silent no-op
 * there would leave a restore reporting success having done nothing, so these
 * throw instead — the asymmetry with `safeWrite` is deliberate.
 */
function assertWritable(op: string): void {
  if (readOnlyReason !== undefined) {
    throw new Error(`[db] ${op} refused: database is read-only (${readOnlyReason})`);
  }
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
  // The latch, at the one point every store write already passes through. A
  // silent no-op is right here: these are mirror writes for state the in-memory
  // store already holds, and the caller has nothing to do about a refusal.
  if (readOnlyReason !== undefined) return;
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
