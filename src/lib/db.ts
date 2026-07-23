import Dexie, { type EntityTable } from "dexie";
import type { BackupData, Exercise, SplitSlot, WorkoutSession, WorkoutSet } from "./store";

/**
 * IndexedDB persistence via Dexie.
 *
 * IMPORTANT: This module is safe to *import* during SSR (Dexie only opens the
 * database lazily, on first actual operation), but every exported function
 * here MUST only ever be *called* from client-side code (inside a useEffect,
 * an event handler, etc). IndexedDB does not exist in the SSR (Node) runtime,
 * and calling any of these during server render will throw.
 */

export type MetaKey = "settings" | "activeSession";

export interface SettingsMeta {
  key: "settings";
  unit: "lbs" | "kg";
  motivationEnabled: boolean;
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

type MetaRecord = SettingsMeta | ActiveSessionMeta;

class WorkoutDb extends Dexie {
  exercises!: EntityTable<Exercise, "id">;
  slots!: EntityTable<SplitSlot, "id">;
  sessions!: EntityTable<WorkoutSession, "id">;
  sets!: EntityTable<WorkoutSet, "id">;
  meta!: EntityTable<MetaRecord, "key">;

  constructor() {
    super("workout-tracker");
    this.version(1).stores({
      exercises: "id",
      slots: "id",
      sessions: "id",
      sets: "id, sessionId",
      meta: "key",
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

export const DEFAULT_SETTINGS: SettingsMeta = {
  key: "settings",
  unit: "lbs",
  motivationEnabled: true,
};

export const EMPTY_ACTIVE_SESSION: ActiveSessionMeta = {
  key: "activeSession",
};

export interface AllData {
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  settings: SettingsMeta;
  activeSession: ActiveSessionMeta;
}

/** Reads every table. Client-only. */
export async function loadAll(): Promise<AllData> {
  const [exercises, slots, sessions, sets, settingsMeta, activeSessionMeta] = await Promise.all([
    db.exercises.toArray(),
    db.slots.toArray(),
    db.sessions.toArray(),
    db.sets.toArray(),
    db.meta.get("settings"),
    db.meta.get("activeSession"),
  ]);
  return {
    exercises,
    slots,
    sessions,
    sets,
    settings: (settingsMeta as SettingsMeta) ?? DEFAULT_SETTINGS,
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
  await db.transaction("rw", db.exercises, db.slots, db.sessions, db.sets, db.meta, async () => {
    await db.exercises.bulkPut(data.exercises);
    await db.slots.bulkPut(data.slots);
    await db.sessions.bulkPut(data.sessions);
    await db.sets.bulkPut(data.sets);
    await db.meta.put(data.settings);
    await db.meta.put(EMPTY_ACTIVE_SESSION);
  });
}

/**
 * Full backup restore: replaces the entire dataset (exercises, slots,
 * sessions, sets, settings) and clears any in-progress workout, in a single
 * Dexie transaction. Either everything lands or nothing does — a failure
 * partway through rolls the whole transaction back, so existing data is
 * never left half-overwritten. Client-only. Caller must have already fully
 * validated `data` (see `parseBackup` in store.ts) — this helper trusts its
 * input completely.
 */
export async function replaceAllData(data: BackupData): Promise<void> {
  await db.transaction("rw", db.exercises, db.slots, db.sessions, db.sets, db.meta, async () => {
    await db.exercises.clear();
    await db.slots.clear();
    await db.sessions.clear();
    await db.sets.clear();
    await db.exercises.bulkPut(data.exercises);
    await db.slots.bulkPut(data.slots);
    await db.sessions.bulkPut(data.sessions);
    await db.sets.bulkPut(data.sets);
    await db.meta.put({ key: "settings", unit: data.unit, motivationEnabled: data.motivationEnabled });
    await db.meta.put(EMPTY_ACTIVE_SESSION);
  });
}

export async function putSettingsMeta(settings: SettingsMeta): Promise<void> {
  await db.meta.put(settings);
}

export async function putActiveSessionMeta(meta: ActiveSessionMeta): Promise<void> {
  await db.meta.put(meta);
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
    });
  } catch (err) {
    console.error("[db] write failed", err);
  }
}
