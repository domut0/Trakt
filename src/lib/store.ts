import { create } from "zustand";
import {
  db,
  defaultTargets,
  isDbEmpty,
  isIndexedDbAvailable,
  loadAll,
  replaceAllData,
  safeWrite,
  seedDb,
  setWriteErrorHandler,
  type ActiveSessionMeta,
  type SettingsMeta,
} from "./db";
import { isDailyLogEmpty } from "./daily-log";
import { targetProfileFor } from "./targets";
import { seedExercises } from "./exercise-library";

export type ExerciseType = "main" | "accessory" | "cardio";

export interface Exercise {
  id: string;
  name: string;
  type: ExerciseType;
  setupNote?: string;
}

export interface SplitSlot {
  id: string;
  name: string;
  rotationOrder: number;
  lastLoggedAt?: number;
}

/**
 * A logged workout. Two variants share this one record, discriminated by `kind`:
 *
 * - **strength** (the default): started via `startWorkout`, belongs to a Split
 *   Slot, accumulates `WorkoutSet`s, and drives every rotation / suggestion /
 *   prefill heuristic in this file.
 * - **cardio**: written in one shot by `logCardio` AFTER the fact. It has NO
 *   Split Slot, no sets, and must stay invisible to all of that strength logic.
 *
 * `kind` is optional and `undefined` MUST read as "strength" — every session
 * recorded before cardio existed has no `kind` at all. Never compare the string
 * inline; go through `isCardioSession` so that default stays in one place.
 *
 * `splitSlotId` is optional for the same reason cardio exists at all: a cardio
 * entry has no slot. Anything matching sessions BY slot has to be careful, since
 * two cardio sessions both carry `undefined` and would otherwise compare equal.
 */
export interface WorkoutSession {
  id: string;
  /** Absent on cardio sessions. Always present on strength sessions. */
  splitSlotId?: string;
  startedAt: number;
  endedAt?: number;
  /** Undefined means "strength" — see `isCardioSession`. */
  kind?: "strength" | "cardio";
  /** Cardio only: the Exercise (of type "cardio") that was performed. */
  cardioExerciseId?: string;
  /** Cardio only. Used to back-compute `startedAt` from the moment it was logged. */
  durationMinutes?: number;
  /** Cardio only. Miles when the unit is lbs, km when the unit is kg. */
  distance?: number;
  /** Cardio only. Snapshot at log time, same pattern as `WorkoutSet.setupNote`. */
  setupNote?: string;
  /** Free-text note for the whole session ("felt flat", "shoulder tweaked").
   * Non-indexed, so adding it needed no Dexie version bump. */
  note?: string;
}

/**
 * The single source of truth for the strength/cardio split. A session with no
 * `kind` is strength, which is what keeps every pre-cardio record valid.
 */
export function isCardioSession(s: WorkoutSession): boolean {
  return s.kind === "cardio";
}

export interface WorkoutSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  weight: number;
  reps: number;
  rpe?: number;
  isDropsetOrPartial?: boolean;
  /** Setup notes captured at log time (e.g. "seat 4, pins 12"). Stored per-set
   * so it's a snapshot: editing next week's note never rewrites this entry.
   * The most recent non-empty note for an exercise is surfaced as a grey
   * suggestion the next time it's logged (see `lastSetupNoteFor`). */
  setupNote?: string;
  timeBetweenSetsSeconds?: number;
  blockGroupId?: string;
  loggedAt: number;
}

/**
 * One row per calendar day of self-reported numbers, upserted as the day is
 * edited. Every field is optional: a day where only bodyweight was recorded is
 * perfectly valid. A record with nothing in it at all is never stored (see
 * `isDailyLogEmpty` / `upsertDailyLog`).
 */
export interface DailyLog {
  /** LOCAL calendar date as "yyyy-MM-dd". Primary key — see `dayKey`. */
  date: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
  /** In the app's current global lbs/kg unit; the number is stored as typed, not converted. */
  bodyweight?: number;
  isCheatDay?: boolean;
}

/**
 * A named set of daily nutrition targets, assigned to weekdays rather than to
 * dates. See targets.ts for why that indirection exists.
 *
 * Every field is optional: targeting calories and protein but not carbs is a
 * completely normal way to eat, and an unset field renders no progress row.
 */
export interface TargetProfile {
  id: string;
  name: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  steps?: number;
}

/**
 * A tracked daily habit, for example a supplement. Order is explicit so the
 * checklist can be reordered without touching ids.
 *
 * Archiving rather than deleting keeps historical `HabitEntry` rows meaningful:
 * a habit you stopped in March should not silently erase the fact that you did
 * it every day in February.
 */
export interface Habit {
  id: string;
  name: string;
  order: number;
  archived?: boolean;
}

/**
 * One habit completed on one day. PRESENCE means done; there is no `done: false`
 * row, so an untouched habit costs no storage at all.
 *
 * `id` is the derived `${date}|${habitId}` composite rather than a random uid,
 * which makes a toggle an idempotent put/delete by key and makes double-tapping
 * impossible to turn into two rows. It is a plain string primary key rather than
 * a Dexie compound index because Dexie's EntityTable typing wants a single key
 * property.
 */
export interface HabitEntry {
  id: string;
  date: string;
  habitId: string;
}

/** The one place the `HabitEntry.id` composite is built. */
export function habitEntryId(date: string, habitId: string): string {
  return `${date}|${habitId}`;
}

/** The shape produced by Settings' "Export backup" action, and the shape
 * `importData` / `replaceAllData` expect back in. Kept flat (no meta
 * nesting) to match the exported JSON exactly.
 *
 * `version` tracks the backup format, not the app: v1 files predate daily
 * logging and have neither key. `parseBackup` reads both tolerantly. */
export interface BackupData {
  version: number;
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  dailyLogs: DailyLog[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  targetProfiles: TargetProfile[];
  weekdayTargets: string[];
  targetsEnabled: boolean;
  habitsEnabled: boolean;
  toolsEnabled: boolean;
  unit: "lbs" | "kg";
}

/** Current backup format version, written by Settings' export.
 *
 * v3 adds cardio: sessions may carry `kind`/`cardioExerciseId`/`durationMinutes`/
 * `distance`/`setupNote` and may omit `splitSlotId`, and exercises may be of type
 * "cardio". Every one of those is optional, so a v1 or v2 file still imports
 * unchanged and its sessions read as strength.
 *
 * v4 adds habit tracking, per-weekday nutrition targets, the three feature
 * toggles they hang off, and session notes. Every one of those is optional on
 * read (see `parseBackup`), so a v1, v2 or v3 file still imports unchanged and
 * simply lands with no habits and a single uniform target profile. */
export const BACKUP_VERSION = 4;

type CurrentBlock = {
  blockGroupId: string;
  targetSets: number;
  loggedInBlock: number;
  weight: number;
  reps: number;
  rpe?: number;
};

interface State {
  unit: "lbs" | "kg";
  chartsEnabled: boolean;
  /** Feature toggles for the three opt-in additions. Off by default: each one
   * adds a surface to a screen whose whole point is having nothing in the way,
   * so the user turns them on deliberately. */
  targetsEnabled: boolean;
  habitsEnabled: boolean;
  toolsEnabled: boolean;
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  dailyLogs: DailyLog[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  targetProfiles: TargetProfile[];
  /** 7 profile ids, MONDAY FIRST. Resolve through targets.ts, never `getDay()`. */
  weekdayTargets: string[];
  activeSessionId?: string;
  currentExerciseId?: string;
  currentBlock?: CurrentBlock;
  /** True once the client-side IndexedDB load (or first-run seed) has completed. */
  hydrated: boolean;
  /** True when the most recent IndexedDB write failed. Ephemeral UI state only:
   * never persisted, never included in a backup. */
  writeFailed: boolean;

  /** Client-only. Loads persisted state from IndexedDB, seeding it on first-ever run. Idempotent. */
  hydrate: () => Promise<void>;
  startWorkout: (slotName: string) => string;
  endWorkout: () => void;
  setCurrentExercise: (exerciseId: string) => void;
  addExercise: (name: string, type: ExerciseType) => Exercise;
  logSet: (input: {
    exerciseId: string;
    weight: number;
    reps: number;
    rpe?: number;
    setupNote?: string;
    targetSets: number;
  }) => void;
  logNextInBlock: (overrides?: { reps?: number }) => void;
  /** Record a completed cardio bout in one shot, after the fact — there is no
   * start/end flow and no stopwatch. Creates a session that is already ended,
   * with no Split Slot and no sets, and returns its id.
   *
   * When a duration is given, `startedAt` is back-computed from it (a 28 minute
   * entry saved at 08:30 records startedAt 08:02) so the bout lands on the
   * timeline where it actually happened. With no duration, startedAt == endedAt.
   *
   * Deliberately does NOT touch activeSessionId / currentExerciseId /
   * currentBlock: logging cardio never puts the app into workout mode. */
  logCardio: (input: {
    exerciseId: string;
    durationMinutes?: number;
    distance?: number;
    setupNote?: string;
  }) => string;
  deleteSet: (setId: string) => void;
  /** Delete an entire logged workout: the session and every set in it. Recomputes
   * the affected split slot's lastLoggedAt from the sessions that remain, and
   * clears the in-progress workout if the deleted session was the active one. */
  deleteSession: (sessionId: string) => void;
  updateSet: (setId: string, patch: Partial<WorkoutSet>) => void;
  /** Merge `patch` into the daily log for `date`, creating the record if there
   * isn't one. If the merged result carries no information (`isDailyLogEmpty`),
   * the record is DELETED instead of stored, so clearing every field leaves no
   * empty shell behind. */
  upsertDailyLog: (date: string, patch: Partial<Omit<DailyLog, "date">>) => void;
  deleteDailyLog: (date: string) => void;
  dailyLogFor: (date: string) => DailyLog | undefined;
  setUnit: (u: "lbs" | "kg") => void;
  setChartsEnabled: (v: boolean) => void;
  setTargetsEnabled: (v: boolean) => void;
  setHabitsEnabled: (v: boolean) => void;
  setToolsEnabled: (v: boolean) => void;

  /** Free-text note on a whole session. */
  updateSession: (sessionId: string, patch: Pick<WorkoutSession, "note">) => void;

  // --- Per-weekday nutrition targets -------------------------------------
  addTargetProfile: (name: string) => TargetProfile;
  updateTargetProfile: (id: string, patch: Partial<Omit<TargetProfile, "id">>) => void;
  /** Removes a profile and repoints every weekday that used it at the first
   * remaining profile, so no weekday is ever left dangling. Refuses to delete
   * the last profile: zero profiles would make the targets editor unreachable
   * with the toggle still on. */
  deleteTargetProfile: (id: string) => void;
  /** `weekdayIndex` is MONDAY-FIRST (0 = Monday). */
  assignWeekdayTarget: (weekdayIndex: number, profileId: string) => void;
  /** The profile in effect on a "yyyy-MM-dd" day key, if any. */
  targetProfileForDate: (date: string) => TargetProfile | undefined;

  // --- Habits ------------------------------------------------------------
  addHabit: (name: string) => Habit;
  renameHabit: (id: string, name: string) => void;
  /** Deletes the habit AND every entry ever recorded for it. */
  deleteHabit: (id: string) => void;
  setHabitArchived: (id: string, archived: boolean) => void;
  reorderHabits: (fromId: string, toId: string) => void;
  /** Flips a habit for a day. Idempotent per (date, habit) by construction:
   * the row's key is derived from both, so there can never be duplicates. */
  toggleHabit: (date: string, habitId: string) => void;
  /** Habit ids completed on a day key. */
  habitsDoneOn: (date: string) => string[];
  reorderSlots: (fromId: string, toId: string) => void;
  /** Full backup restore. Assumes `data` has already been validated by
   * `parseBackup` — replaces IndexedDB first (single transaction; a failure
   * there rejects and leaves both the DB and the in-memory store untouched),
   * then mirrors the same data into the live store and clears any
   * in-progress workout, since a fresh backup has none. */
  importData: (data: BackupData) => Promise<void>;
  /** Wipe all logged data (slots, sessions, sets), reset settings to defaults,
   * and restore the exercise preset library — a clean slate for testing. The
   * preset library is re-seeded so the picker stays usable AND so the DB is not
   * "empty" (which would make hydrate re-insert the demo history on next load). */
  clearAllData: () => Promise<void>;
  predictedNextSlotName: () => string | undefined;
  suggestedNextExerciseFor: (
    sessionId: string,
  ) => { exerciseId: string; weight?: number; reps?: number; rpe?: number } | undefined;
  prefillFor: (
    sessionId: string,
    exerciseId: string,
  ) => { weight?: number; reps?: number; rpe?: number };
  /** The setup note to suggest for an exercise: the most recently logged
   * non-empty per-set note, falling back to the exercise's base note. Persists
   * across workouts so last week's setup shows up as a grey hint this week. */
  lastSetupNoteFor: (exerciseId: string) => string | undefined;
  /** Clears the write-failure banner. Does not retry the write; the in-memory
   * state is already current, this only dismisses the notice. */
  dismissWriteError: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Seed data — a couple of realistic sessions so the UI has something to render.
// Used ONLY by hydrate() to populate a brand-new (empty) IndexedDB on first run.
// The store's own default state is empty arrays (see useStore below); these
// constants are no longer read directly as the default state.
const now = Date.now();
const day = 86400000;

const seedSlots: SplitSlot[] = [
  { id: "s_hb", name: "Heavy Bench", rotationOrder: 0, lastLoggedAt: now - 3 * day },
  { id: "s_sq", name: "Squat", rotationOrder: 1, lastLoggedAt: now - 2 * day },
  { id: "s_vb", name: "Volume Bench", rotationOrder: 2, lastLoggedAt: now - day },
  { id: "s_arms", name: "Arms", rotationOrder: 3, lastLoggedAt: now - 5 * day },
];

const seedSessions: WorkoutSession[] = [
  {
    id: "sess_1",
    splitSlotId: "s_hb",
    startedAt: now - 3 * day,
    endedAt: now - 3 * day + 3600_000,
  },
  {
    id: "sess_2",
    splitSlotId: "s_sq",
    startedAt: now - 2 * day,
    endedAt: now - 2 * day + 3900_000,
  },
  { id: "sess_3", splitSlotId: "s_vb", startedAt: now - day, endedAt: now - day + 3400_000 },
];

const b1 = uid(),
  b2 = uid(),
  b3 = uid(),
  b4 = uid(),
  b5 = uid();
const seedSets: WorkoutSet[] = [
  // Heavy Bench 3 days ago
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 225,
    reps: 3,
    rpe: 7,
    blockGroupId: b1,
    loggedAt: now - 3 * day + 600_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 5,
    rpe: 6,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 240,
    loggedAt: now - 3 * day + 900_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 5,
    rpe: 7,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 220,
    loggedAt: now - 3 * day + 1130_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 5,
    rpe: 8,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 235,
    loggedAt: now - 3 * day + 1370_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_bench",
    weight: 190,
    reps: 4,
    rpe: 9,
    blockGroupId: b2,
    timeBetweenSetsSeconds: 250,
    loggedAt: now - 3 * day + 1625_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_flap",
    weight: 57.5,
    reps: 6,
    rpe: 10,
    blockGroupId: b3,
    timeBetweenSetsSeconds: 300,
    loggedAt: now - 3 * day + 2000_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_flap",
    weight: 57.5,
    reps: 6,
    rpe: 10,
    blockGroupId: b3,
    timeBetweenSetsSeconds: 280,
    loggedAt: now - 3 * day + 2290_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_push",
    weight: 60,
    reps: 12,
    rpe: 9,
    blockGroupId: b4,
    timeBetweenSetsSeconds: 200,
    loggedAt: now - 3 * day + 2600_000,
  },
  {
    id: uid(),
    sessionId: "sess_1",
    exerciseId: "e_push",
    weight: 60,
    reps: 10,
    rpe: 10,
    blockGroupId: b4,
    timeBetweenSetsSeconds: 210,
    loggedAt: now - 3 * day + 2820_000,
  },
  // Squat 2 days ago
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 275,
    reps: 3,
    rpe: 8,
    blockGroupId: uid(),
    loggedAt: now - 2 * day + 600_000,
  },
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 245,
    reps: 5,
    rpe: 7,
    blockGroupId: b5,
    timeBetweenSetsSeconds: 260,
    loggedAt: now - 2 * day + 900_000,
  },
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 245,
    reps: 5,
    rpe: 8,
    blockGroupId: b5,
    timeBetweenSetsSeconds: 245,
    loggedAt: now - 2 * day + 1160_000,
  },
  {
    id: uid(),
    sessionId: "sess_2",
    exerciseId: "e_squat",
    weight: 245,
    reps: 5,
    rpe: 9,
    blockGroupId: b5,
    timeBetweenSetsSeconds: 255,
    loggedAt: now - 2 * day + 1415_000,
  },
  // Volume Bench yesterday
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_bench",
    weight: 175,
    reps: 6,
    rpe: 7,
    blockGroupId: uid(),
    loggedAt: now - day + 600_000,
  },
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_bench",
    weight: 175,
    reps: 6,
    rpe: 8,
    blockGroupId: uid(),
    timeBetweenSetsSeconds: 200,
    loggedAt: now - day + 800_000,
  },
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_row",
    weight: 90,
    reps: 10,
    rpe: 8,
    blockGroupId: uid(),
    timeBetweenSetsSeconds: 190,
    loggedAt: now - day + 1100_000,
  },
  {
    id: uid(),
    sessionId: "sess_3",
    exerciseId: "e_row",
    weight: 90,
    reps: 10,
    rpe: 9,
    blockGroupId: uid(),
    timeBetweenSetsSeconds: 200,
    loggedAt: now - day + 1300_000,
  },
];

// ---------------------------------------------------------------------------
// Pure logic, extracted so it can be unit-tested with plain arrays — no store,
// no IndexedDB, no React. The store actions below are thin wrappers around
// these that read current state via get() and delegate here. Behavior must
// stay identical to the original inline implementations.
// ---------------------------------------------------------------------------

/** Rotation round-robin: predicts the next Split Slot name after whichever slot was most recently logged. */
export function predictNextSlotName(slots: SplitSlot[]): string | undefined {
  const sorted = [...slots].sort((a, b) => a.rotationOrder - b.rotationOrder);
  if (sorted.length === 0) return undefined;
  const lastLogged = sorted
    .filter((s) => s.lastLoggedAt)
    .sort((a, b) => (b.lastLoggedAt ?? 0) - (a.lastLoggedAt ?? 0))[0];
  if (!lastLogged) return sorted[0].name;
  const idx = sorted.findIndex((s) => s.id === lastLogged.id);
  return sorted[(idx + 1) % sorted.length].name;
}

/** Case-insensitive, whitespace-trimmed Split Slot lookup by name. */
export function matchSlot(slots: SplitSlot[], name: string): SplitSlot | undefined {
  const key = name.trim().toLowerCase();
  return slots.find((s) => s.name.trim().toLowerCase() === key);
}

/**
 * Finds the previous completed occurrence of the same Split Slot as `sess`,
 * for the "pull from last time" heuristics below.
 *
 * Two guards matter here, and both exist because cardio sessions live in this
 * same array. Cardio sessions are excluded outright, and a session with no
 * `splitSlotId` never matches anything — otherwise two cardio bouts, which BOTH
 * carry `splitSlotId === undefined`, would compare equal to each other and to
 * any other slot-less session, and a treadmill run would start feeding the
 * suggestion and prefill engines.
 */
function findLastSessionForSlot(
  sessions: WorkoutSession[],
  sess: WorkoutSession,
): WorkoutSession | undefined {
  if (isCardioSession(sess) || sess.splitSlotId == null) return undefined;
  return sessions
    .filter(
      (s) =>
        !isCardioSession(s) &&
        s.splitSlotId != null &&
        s.splitSlotId === sess.splitSlotId &&
        s.id !== sess.id &&
        s.endedAt,
    )
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
}

/**
 * "Next Exercise" suggestion: pulls from the last occurrence of the SAME
 * Split Slot, advancing one exercise at a time in the order they were logged
 * that day, skipping exercises already done in the current session.
 *
 * Strength-only: cardio sessions are neither a source nor a target (see
 * `findLastSessionForSlot`).
 */
export function suggestNextExercise(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string,
): { exerciseId: string; weight?: number; reps?: number; rpe?: number } | undefined {
  const sess = sessions.find((s) => s.id === sessionId);
  if (!sess) return undefined;
  const doneExerciseIds = new Set(
    sets.filter((s) => s.sessionId === sessionId).map((s) => s.exerciseId),
  );
  // Last strength session of this slot (excluding current)
  const lastSess = findLastSessionForSlot(sessions, sess);
  if (!lastSess) return undefined;
  const setsInLast = sets
    .filter((s) => s.sessionId === lastSess.id)
    .sort((a, b) => a.loggedAt - b.loggedAt);
  const order: string[] = [];
  for (const s of setsInLast) if (!order.includes(s.exerciseId)) order.push(s.exerciseId);
  const next = order.find((id) => !doneExerciseIds.has(id));
  if (!next) return undefined;
  const firstSet = setsInLast.find((s) => s.exerciseId === next);
  return { exerciseId: next, weight: firstSet?.weight, reps: firstSet?.reps, rpe: firstSet?.rpe };
}

/**
 * Distinct-weight-block matching: the Nth distinct weight/rep block logged
 * for an exercise in today's session prefills from the Nth distinct
 * weight/rep block logged for that exercise the last time this same Split
 * Slot occurred.
 *
 * Strength-only: cardio sessions are neither a source nor a target (see
 * `findLastSessionForSlot`).
 */
export function computePrefill(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string,
  exerciseId: string,
): { weight?: number; reps?: number; rpe?: number } {
  const sess = sessions.find((s) => s.id === sessionId);
  if (!sess) return {};
  const setsToday = sets.filter((s) => s.sessionId === sessionId && s.exerciseId === exerciseId);
  const distinctToday = new Set(setsToday.map((s) => `${s.weight}x${s.reps}`)).size;
  const lastSess = findLastSessionForSlot(sessions, sess);
  if (!lastSess) return {};
  const lastSets = sets
    .filter((s) => s.sessionId === lastSess.id && s.exerciseId === exerciseId)
    .sort((a, b) => a.loggedAt - b.loggedAt);
  const distinctBlocks: WorkoutSet[] = [];
  const seen = new Set<string>();
  for (const s of lastSets) {
    const k = `${s.weight}x${s.reps}`;
    if (!seen.has(k)) {
      seen.add(k);
      distinctBlocks.push(s);
    }
  }
  const target = distinctBlocks[distinctToday];
  if (!target) return {};
  return { weight: target.weight, reps: target.reps, rpe: target.rpe };
}

export type ParseBackupResult = { ok: true; data: BackupData } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isExercise(v: unknown): v is Exercise {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.name !== "string") return false;
  if (v.type !== "main" && v.type !== "accessory" && v.type !== "cardio") return false;
  if (v.setupNote !== undefined && typeof v.setupNote !== "string") return false;
  return true;
}

function isSplitSlot(v: unknown): v is SplitSlot {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.name !== "string") return false;
  if (typeof v.rotationOrder !== "number") return false;
  if (v.lastLoggedAt !== undefined && typeof v.lastLoggedAt !== "number") return false;
  return true;
}

function isWorkoutSession(v: unknown): v is WorkoutSession {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  // Optional as of v3: cardio sessions have no Split Slot. Still must be a
  // string when it IS present, so a malformed strength session is caught.
  if (v.splitSlotId !== undefined && typeof v.splitSlotId !== "string") return false;
  if (typeof v.startedAt !== "number") return false;
  if (v.endedAt !== undefined && typeof v.endedAt !== "number") return false;
  // Absent entirely = a pre-v3 session, which is strength by definition. Present
  // but not one of the two known kinds = a corrupt file.
  if (v.kind !== undefined && v.kind !== "strength" && v.kind !== "cardio") return false;
  if (v.cardioExerciseId !== undefined && typeof v.cardioExerciseId !== "string") return false;
  if (!isOptionalNumber(v.durationMinutes)) return false;
  if (!isOptionalNumber(v.distance)) return false;
  if (v.setupNote !== undefined && typeof v.setupNote !== "string") return false;
  return true;
}

function isWorkoutSet(v: unknown): v is WorkoutSet {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.sessionId !== "string") return false;
  if (typeof v.exerciseId !== "string") return false;
  if (typeof v.weight !== "number") return false;
  if (typeof v.reps !== "number") return false;
  if (v.rpe !== undefined && typeof v.rpe !== "number") return false;
  if (v.isDropsetOrPartial !== undefined && typeof v.isDropsetOrPartial !== "boolean") return false;
  if (v.setupNote !== undefined && typeof v.setupNote !== "string") return false;
  if (v.timeBetweenSetsSeconds !== undefined && typeof v.timeBetweenSetsSeconds !== "number")
    return false;
  if (v.blockGroupId !== undefined && typeof v.blockGroupId !== "string") return false;
  if (typeof v.loggedAt !== "number") return false;
  return true;
}

function isOptionalNumber(v: unknown): boolean {
  return v === undefined || typeof v === "number";
}

function isDailyLog(v: unknown): v is DailyLog {
  if (!isPlainObject(v)) return false;
  if (typeof v.date !== "string" || v.date.length === 0) return false;
  if (!isOptionalNumber(v.calories)) return false;
  if (!isOptionalNumber(v.protein)) return false;
  if (!isOptionalNumber(v.carbs)) return false;
  if (!isOptionalNumber(v.fat)) return false;
  if (!isOptionalNumber(v.steps)) return false;
  if (!isOptionalNumber(v.bodyweight)) return false;
  if (v.isCheatDay !== undefined && typeof v.isCheatDay !== "boolean") return false;
  return true;
}

/**
 * Parses and fully validates a backup JSON string against the exact shape
 * `exportJson` in Settings produces. Pure — no IndexedDB, no store, no DOM —
 * so the import flow can validate a file completely before touching
 * persistence, and this can be unit-tested directly. Never throws; returns a
 * discriminated result instead.
 *
 * Deliberately TOLERANT about the format version. A v1 file (written before
 * daily logging existed) has no `version` and no `dailyLogs`; both default
 * rather than failing. A version number from the future is also accepted on a
 * best-effort basis — the keys we understand are read, the rest ignored. The
 * only hard failures are structural: keys that ARE present but the wrong shape.
 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isTargetProfile(v: unknown): v is TargetProfile {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    typeof v.name === "string" &&
    isOptionalNumber(v.calories) &&
    isOptionalNumber(v.protein) &&
    isOptionalNumber(v.carbs) &&
    isOptionalNumber(v.fat) &&
    isOptionalNumber(v.steps)
  );
}

function isHabit(v: unknown): v is Habit {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    typeof v.name === "string" &&
    typeof v.order === "number" &&
    (v.archived === undefined || typeof v.archived === "boolean")
  );
}

function isHabitEntry(v: unknown): v is HabitEntry {
  if (!isPlainObject(v)) return false;
  return isNonEmptyString(v.id) && isNonEmptyString(v.date) && isNonEmptyString(v.habitId);
}

export function parseBackup(text: string): ParseBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "That file does not contain a backup." };
  }
  const { exercises, slots, sessions, sets, dailyLogs, unit, version } = parsed;
  if (!Array.isArray(exercises) || !exercises.every(isExercise)) {
    return { ok: false, error: "The backup's exercises list is missing or malformed." };
  }
  if (!Array.isArray(slots) || !slots.every(isSplitSlot)) {
    return { ok: false, error: "The backup's split slots list is missing or malformed." };
  }
  if (!Array.isArray(sessions) || !sessions.every(isWorkoutSession)) {
    return { ok: false, error: "The backup's sessions list is missing or malformed." };
  }
  if (!Array.isArray(sets) || !sets.every(isWorkoutSet)) {
    return { ok: false, error: "The backup's sets list is missing or malformed." };
  }
  // Absent entirely = a pre-v2 backup, which simply had no daily logs. Present
  // but not a well-formed array = a corrupt file, which is a real error.
  if (dailyLogs !== undefined && (!Array.isArray(dailyLogs) || !dailyLogs.every(isDailyLog))) {
    return { ok: false, error: "The backup's daily logs list is malformed." };
  }
  if (unit !== "lbs" && unit !== "kg") {
    return { ok: false, error: "The backup's unit must be lbs or kg." };
  }
  // Everything v4 added is read tolerantly rather than validated hard: a v1-v3
  // file legitimately has none of it, and a partially-hand-edited file should
  // land with those features empty rather than fail the whole import. The
  // weekdayTargets length check matters because targets.ts treats any array that
  // is not exactly 7 long as "no target", so a malformed one would silently
  // disable targets instead of being replaced with a working default.
  const fallbackTargets = defaultTargets();
  const rawWeekdays = (parsed as { weekdayTargets?: unknown }).weekdayTargets;
  const rawProfiles = (parsed as { targetProfiles?: unknown }).targetProfiles;
  const rawHabits = (parsed as { habits?: unknown }).habits;
  const rawHabitEntries = (parsed as { habitEntries?: unknown }).habitEntries;
  const weekdayTargets =
    Array.isArray(rawWeekdays) && rawWeekdays.length === 7 && rawWeekdays.every(isNonEmptyString)
      ? (rawWeekdays as string[])
      : fallbackTargets.weekdayTargets;
  const targetProfiles =
    Array.isArray(rawProfiles) && rawProfiles.every(isTargetProfile) && rawProfiles.length > 0
      ? (rawProfiles as TargetProfile[])
      : fallbackTargets.targetProfiles;
  // If the profiles fell back but the assignments did not, every weekday would
  // point at an id that no longer exists. Re-derive both together in that case.
  const profileIds = new Set(targetProfiles.map((p) => p.id));
  const safeWeekdays = weekdayTargets.every((id) => profileIds.has(id))
    ? weekdayTargets
    : fallbackTargets.weekdayTargets;

  return {
    ok: true,
    data: {
      // No `version` means a v1 file. An unrecognised version is kept as-is and
      // imported anyway rather than rejected.
      version: typeof version === "number" ? version : 1,
      exercises: exercises as Exercise[],
      slots: slots as SplitSlot[],
      sessions: sessions as WorkoutSession[],
      sets: sets as WorkoutSet[],
      dailyLogs: (dailyLogs as DailyLog[] | undefined) ?? [],
      habits: Array.isArray(rawHabits) && rawHabits.every(isHabit) ? (rawHabits as Habit[]) : [],
      habitEntries:
        Array.isArray(rawHabitEntries) && rawHabitEntries.every(isHabitEntry)
          ? (rawHabitEntries as HabitEntry[])
          : [],
      targetProfiles,
      weekdayTargets: safeWeekdays,
      targetsEnabled: (parsed as { targetsEnabled?: unknown }).targetsEnabled === true,
      habitsEnabled: (parsed as { habitsEnabled?: unknown }).habitsEnabled === true,
      toolsEnabled: (parsed as { toolsEnabled?: unknown }).toolsEnabled === true,
      unit,
    },
  };
}

// ---------------------------------------------------------------------------
// Write-through persistence helpers. Every mutating store action calls one of
// these right after updating Zustand state. All of them are safe no-ops (they
// log and swallow) if the DB write fails — the in-memory state already won.
// These are only ever invoked from store actions, which only ever run from
// client-side user interaction — never during SSR render.
// ---------------------------------------------------------------------------

function persistActiveMeta(meta: {
  activeSessionId?: string;
  currentExerciseId?: string;
  currentBlock?: CurrentBlock;
}) {
  // Annotated before the put for the same reason as persistSettingsFrom: `meta`
  // is a union table, and an inline literal resolves against the wrong arm.
  const record: ActiveSessionMeta = {
    key: "activeSession",
    activeSessionId: meta.activeSessionId,
    currentExerciseId: meta.currentExerciseId,
    currentBlock: meta.currentBlock,
  };
  safeWrite(() => db.meta.put(record));
}

/**
 * Writes the whole settings record from current store state.
 *
 * Takes no arguments deliberately. The previous signature listed every field,
 * and each new setting silently changed it, so a caller that forgot to thread a
 * value through would persist a stale one. Reading straight from the store means
 * callers only have to `set()` first and the mirror always matches.
 *
 * Annotated as SettingsMeta before the put: `meta` is a union table, and an
 * inline literal makes Dexie's InsertType resolve against the wrong arm of the
 * union, which is a type error even though the value is perfectly valid.
 */
function persistSettingsFrom(s: State) {
  const settings: SettingsMeta = {
    key: "settings",
    unit: s.unit,
    chartsEnabled: s.chartsEnabled,
    targetsEnabled: s.targetsEnabled,
    habitsEnabled: s.habitsEnabled,
    toolsEnabled: s.toolsEnabled,
    targetProfiles: s.targetProfiles,
    weekdayTargets: s.weekdayTargets,
  };
  safeWrite(() => db.meta.put(settings));
}

export const useStore = create<State>((set, get) => ({
  unit: "lbs",
  chartsEnabled: true,
  targetsEnabled: false,
  habitsEnabled: false,
  toolsEnabled: false,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
  habits: [],
  habitEntries: [],
  ...defaultTargets(),
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,
  hydrated: false,
  writeFailed: false,

  hydrate: async () => {
    if (get().hydrated) return; // idempotent — never double-seed/duplicate on repeat calls
    if (!isIndexedDbAvailable()) {
      // Should never happen (hydrate is only ever invoked from a client-side
      // effect), but never leave the app stuck un-hydrated.
      set({ hydrated: true });
      return;
    }
    try {
      const empty = await isDbEmpty();
      if (empty) {
        const targets = defaultTargets();
        const settings: SettingsMeta = {
          key: "settings",
          unit: "lbs",
          chartsEnabled: true,
          targetsEnabled: false,
          habitsEnabled: false,
          toolsEnabled: false,
          ...targets,
        };
        await seedDb({
          exercises: seedExercises,
          slots: seedSlots,
          sessions: seedSessions,
          sets: seedSets,
          settings,
        });
        set({
          exercises: seedExercises,
          slots: seedSlots,
          sessions: seedSessions,
          sets: seedSets,
          dailyLogs: [], // a first run seeds no daily logs
          habits: [], // nor any habits: the checklist starts empty and opt-in
          habitEntries: [],
          unit: settings.unit,
          chartsEnabled: true,
          targetsEnabled: false,
          habitsEnabled: false,
          toolsEnabled: false,
          ...targets,
          activeSessionId: undefined,
          currentExerciseId: undefined,
          currentBlock: undefined,
          hydrated: true,
        });
        return;
      }
      const data = await loadAll();
      // loadAll already backfills targetProfiles/weekdayTargets for records
      // written before targets existed, so these two are safe to trust here.
      set({
        exercises: data.exercises,
        slots: data.slots,
        sessions: data.sessions,
        sets: data.sets,
        dailyLogs: data.dailyLogs,
        habits: data.habits,
        habitEntries: data.habitEntries,
        unit: data.settings.unit,
        chartsEnabled: data.settings.chartsEnabled ?? true,
        targetsEnabled: data.settings.targetsEnabled ?? false,
        habitsEnabled: data.settings.habitsEnabled ?? false,
        toolsEnabled: data.settings.toolsEnabled ?? false,
        targetProfiles: data.settings.targetProfiles ?? defaultTargets().targetProfiles,
        weekdayTargets: data.settings.weekdayTargets ?? defaultTargets().weekdayTargets,
        activeSessionId: data.activeSession.activeSessionId,
        currentExerciseId: data.activeSession.currentExerciseId,
        currentBlock: data.activeSession.currentBlock,
        hydrated: true,
      });
    } catch (err) {
      console.error("[store] hydrate failed", err);
      set({ hydrated: true }); // don't leave the UI stuck; falls back to empty in-memory state
    }
  },

  predictedNextSlotName: () => predictNextSlotName(get().slots),

  startWorkout: (slotName) => {
    const trimmed = slotName.trim();
    let slot = matchSlot(get().slots, trimmed);
    if (!slot) {
      const maxOrder = Math.max(-1, ...get().slots.map((s) => s.rotationOrder));
      slot = { id: uid(), name: trimmed, rotationOrder: maxOrder + 1 };
      set({ slots: [...get().slots, slot] });
      safeWrite(() => db.slots.put(slot!));
    }
    const sessionId = uid();
    const session: WorkoutSession = { id: sessionId, splitSlotId: slot.id, startedAt: Date.now() };
    set({
      sessions: [...get().sessions, session],
      activeSessionId: sessionId,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
    safeWrite(() => db.sessions.put(session));
    persistActiveMeta({
      activeSessionId: sessionId,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
    return sessionId;
  },

  endWorkout: () => {
    const id = get().activeSessionId;
    if (!id) return;
    const sess = get().sessions.find((s) => s.id === id);
    const endedAt = Date.now();
    const updatedSessions = get().sessions.map((s) => (s.id === id ? { ...s, endedAt } : s));
    // Rotation bookkeeping is strength-only. A cardio session (or any session
    // without a Split Slot) must never stamp a slot's lastLoggedAt, or it would
    // advance the round-robin and make the app predict the wrong next workout.
    const touchesSlot = sess != null && !isCardioSession(sess) && sess.splitSlotId != null;
    const updatedSlots = touchesSlot
      ? get().slots.map((sl) =>
          sl.id === sess.splitSlotId ? { ...sl, lastLoggedAt: endedAt } : sl,
        )
      : get().slots;
    set({
      sessions: updatedSessions,
      slots: updatedSlots,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
    const updatedSession = updatedSessions.find((s) => s.id === id);
    if (updatedSession) safeWrite(() => db.sessions.put(updatedSession));
    if (touchesSlot) {
      const updatedSlot = updatedSlots.find((sl) => sl.id === sess.splitSlotId);
      if (updatedSlot) safeWrite(() => db.slots.put(updatedSlot));
    }
    persistActiveMeta({
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  setCurrentExercise: (exerciseId) => {
    set({ currentExerciseId: exerciseId, currentBlock: undefined });
    persistActiveMeta({
      activeSessionId: get().activeSessionId,
      currentExerciseId: exerciseId,
      currentBlock: undefined,
    });
  },

  addExercise: (name, type) => {
    const ex: Exercise = { id: uid(), name: name.trim(), type };
    set({ exercises: [...get().exercises, ex] });
    safeWrite(() => db.exercises.put(ex));
    return ex;
  },

  logSet: ({ exerciseId, weight, reps, rpe, setupNote, targetSets }) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const blockGroupId = uid();
    const setsInSession = get().sets.filter((s) => s.sessionId === sessionId);
    const lastLogged = setsInSession.sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const tbs = lastLogged ? Math.round((Date.now() - lastLogged.loggedAt) / 1000) : undefined;
    const note = setupNote?.trim();
    const newSet: WorkoutSet = {
      id: uid(),
      sessionId,
      exerciseId,
      weight,
      reps,
      rpe,
      setupNote: note || undefined,
      timeBetweenSetsSeconds: tbs,
      blockGroupId,
      loggedAt: Date.now(),
    };
    const currentBlock: CurrentBlock | undefined =
      targetSets > 1
        ? { blockGroupId, targetSets, loggedInBlock: 1, weight, reps, rpe }
        : undefined;
    set({
      sets: [...get().sets, newSet],
      currentExerciseId: exerciseId,
      currentBlock,
    });
    safeWrite(() => db.sets.put(newSet));
    persistActiveMeta({ activeSessionId: sessionId, currentExerciseId: exerciseId, currentBlock });
  },

  logNextInBlock: (overrides) => {
    const { activeSessionId, currentBlock, sets } = get();
    if (!activeSessionId || !currentBlock) return;
    const lastLogged = [...sets]
      .filter((s) => s.sessionId === activeSessionId)
      .sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const tbs = lastLogged ? Math.round((Date.now() - lastLogged.loggedAt) / 1000) : undefined;
    const exerciseId = lastLogged?.exerciseId ?? get().currentExerciseId!;
    const newSet: WorkoutSet = {
      id: uid(),
      sessionId: activeSessionId,
      exerciseId,
      weight: currentBlock.weight,
      reps: overrides?.reps ?? currentBlock.reps,
      rpe: currentBlock.rpe,
      setupNote: lastLogged?.setupNote,
      timeBetweenSetsSeconds: tbs,
      blockGroupId: currentBlock.blockGroupId,
      loggedAt: Date.now(),
    };
    const nextCount = currentBlock.loggedInBlock + 1;
    const updatedBlock: CurrentBlock = { ...currentBlock, loggedInBlock: nextCount };
    set({
      sets: [...sets, newSet],
      currentBlock: updatedBlock,
    });
    safeWrite(() => db.sets.put(newSet));
    persistActiveMeta({
      activeSessionId,
      currentExerciseId: get().currentExerciseId,
      currentBlock: updatedBlock,
    });
  },

  logCardio: ({ exerciseId, durationMinutes, distance, setupNote }) => {
    const endedAt = Date.now();
    // The bout finished now, so a duration tells us when it STARTED: 28 minutes
    // logged at 08:30 began at 08:02. Back-computing here is what lets cardio
    // land on the timeline at the right time despite being entered after the
    // fact. No duration means there is nothing to subtract.
    const startedAt =
      durationMinutes != null ? endedAt - Math.round(durationMinutes * 60_000) : endedAt;
    const note = setupNote?.trim();
    const session: WorkoutSession = {
      id: uid(),
      // No splitSlotId: cardio is outside the rotation entirely.
      startedAt,
      endedAt,
      kind: "cardio",
      cardioExerciseId: exerciseId,
      durationMinutes,
      distance,
      setupNote: note || undefined,
    };
    // Sessions only. No sets are created, and activeSessionId /
    // currentExerciseId / currentBlock are deliberately left alone — logging
    // cardio after the fact must never put the app into workout mode.
    set({ sessions: [...get().sessions, session] });
    safeWrite(() => db.sessions.put(session));
    return session.id;
  },

  deleteSet: (setId) => {
    set({ sets: get().sets.filter((s) => s.id !== setId) });
    safeWrite(() => db.sets.delete(setId));
  },

  deleteSession: (sessionId) => {
    const sess = get().sessions.find((s) => s.id === sessionId);
    const sessions = get().sessions.filter((s) => s.id !== sessionId);
    const sets = get().sets.filter((s) => s.sessionId !== sessionId);
    let slots = get().slots;
    // Only a strength session owns a slot's lastLoggedAt, so only deleting one
    // recomputes it — and the recomputation itself counts strength sessions
    // only. Without that second filter, a cardio session sitting in the same
    // array would be picked up here (its splitSlotId is undefined, which would
    // match any other slot-less session) and resurrect a bogus timestamp.
    const recomputesSlot = sess != null && !isCardioSession(sess) && sess.splitSlotId != null;
    if (recomputesSlot) {
      const remainingForSlot = sessions.filter(
        (s) =>
          !isCardioSession(s) &&
          s.splitSlotId != null &&
          s.splitSlotId === sess.splitSlotId &&
          s.endedAt != null,
      );
      const newLast = remainingForSlot.length
        ? Math.max(...remainingForSlot.map((s) => s.endedAt!))
        : undefined;
      slots = get().slots.map((sl) =>
        sl.id === sess.splitSlotId ? { ...sl, lastLoggedAt: newLast } : sl,
      );
    }
    const clearingActive = get().activeSessionId === sessionId;
    set({
      sessions,
      sets,
      slots,
      ...(clearingActive
        ? { activeSessionId: undefined, currentExerciseId: undefined, currentBlock: undefined }
        : {}),
    });
    safeWrite(() => db.sessions.delete(sessionId));
    safeWrite(() => db.sets.where("sessionId").equals(sessionId).delete());
    if (recomputesSlot) {
      const updatedSlot = slots.find((sl) => sl.id === sess.splitSlotId);
      if (updatedSlot) safeWrite(() => db.slots.put(updatedSlot));
    }
    if (clearingActive) {
      persistActiveMeta({
        activeSessionId: undefined,
        currentExerciseId: undefined,
        currentBlock: undefined,
      });
    }
  },

  updateSet: (setId, patch) => {
    set({ sets: get().sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) });
    const updated = get().sets.find((s) => s.id === setId);
    if (updated) safeWrite(() => db.sets.put(updated));
  },

  upsertDailyLog: (date, patch) => {
    const existing = get().dailyLogs.find((l) => l.date === date);
    const merged: DailyLog = { ...(existing ?? { date }), ...patch, date };
    if (isDailyLogEmpty(merged)) {
      // Everything was cleared. Drop the row rather than keeping a shell that
      // would show up as a "logged" day everywhere it's counted.
      if (!existing) return;
      set({ dailyLogs: get().dailyLogs.filter((l) => l.date !== date) });
      safeWrite(() => db.dailyLogs.delete(date));
      return;
    }
    set({
      dailyLogs: existing
        ? get().dailyLogs.map((l) => (l.date === date ? merged : l))
        : [...get().dailyLogs, merged],
    });
    safeWrite(() => db.dailyLogs.put(merged));
  },

  deleteDailyLog: (date) => {
    set({ dailyLogs: get().dailyLogs.filter((l) => l.date !== date) });
    safeWrite(() => db.dailyLogs.delete(date));
  },

  dailyLogFor: (date) => get().dailyLogs.find((l) => l.date === date),

  setUnit: (u) => {
    set({ unit: u });
    persistSettingsFrom(get());
  },

  setChartsEnabled: (v) => {
    set({ chartsEnabled: v });
    persistSettingsFrom(get());
  },

  setTargetsEnabled: (v) => {
    set({ targetsEnabled: v });
    persistSettingsFrom(get());
  },

  setHabitsEnabled: (v) => {
    set({ habitsEnabled: v });
    persistSettingsFrom(get());
  },

  setToolsEnabled: (v) => {
    set({ toolsEnabled: v });
    persistSettingsFrom(get());
  },

  updateSession: (sessionId, patch) => {
    set({ sessions: get().sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)) });
    const updated = get().sessions.find((s) => s.id === sessionId);
    if (updated) safeWrite(() => db.sessions.put(updated));
  },

  // --- Per-weekday nutrition targets -------------------------------------

  addTargetProfile: (name) => {
    const profile: TargetProfile = { id: `tp_${uid()}`, name: name.trim() || "Untitled" };
    set({ targetProfiles: [...get().targetProfiles, profile] });
    persistSettingsFrom(get());
    return profile;
  },

  updateTargetProfile: (id, patch) => {
    set({
      targetProfiles: get().targetProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
    persistSettingsFrom(get());
  },

  deleteTargetProfile: (id) => {
    const remaining = get().targetProfiles.filter((p) => p.id !== id);
    // Deleting the last profile would leave the targets editor with nothing to
    // edit while the feature is still switched on. Turning the feature off is
    // the way to get rid of targets; this is not it.
    if (remaining.length === 0) return;
    const fallback = remaining[0].id;
    set({
      targetProfiles: remaining,
      weekdayTargets: get().weekdayTargets.map((assigned) =>
        assigned === id ? fallback : assigned,
      ),
    });
    persistSettingsFrom(get());
  },

  assignWeekdayTarget: (weekdayIndex, profileId) => {
    if (weekdayIndex < 0 || weekdayIndex > 6) return;
    if (!get().targetProfiles.some((p) => p.id === profileId)) return;
    const next = [...get().weekdayTargets];
    next[weekdayIndex] = profileId;
    set({ weekdayTargets: next });
    persistSettingsFrom(get());
  },

  targetProfileForDate: (date) =>
    targetProfileFor(date, get().targetProfiles, get().weekdayTargets),

  // --- Habits ------------------------------------------------------------

  addHabit: (name) => {
    const orders = get().habits.map((h) => h.order);
    const habit: Habit = {
      id: `h_${uid()}`,
      name: name.trim() || "Untitled",
      order: orders.length ? Math.max(...orders) + 1 : 0,
    };
    set({ habits: [...get().habits, habit] });
    safeWrite(() => db.habits.put(habit));
    return habit;
  },

  renameHabit: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({ habits: get().habits.map((h) => (h.id === id ? { ...h, name: trimmed } : h)) });
    const updated = get().habits.find((h) => h.id === id);
    if (updated) safeWrite(() => db.habits.put(updated));
  },

  deleteHabit: (id) => {
    set({
      habits: get().habits.filter((h) => h.id !== id),
      habitEntries: get().habitEntries.filter((e) => e.habitId !== id),
    });
    safeWrite(() => db.habits.delete(id));
    // Indexed on habitId precisely so this sweep does not have to scan the table.
    safeWrite(() => db.habitEntries.where("habitId").equals(id).delete());
  },

  setHabitArchived: (id, archived) => {
    set({ habits: get().habits.map((h) => (h.id === id ? { ...h, archived } : h)) });
    const updated = get().habits.find((h) => h.id === id);
    if (updated) safeWrite(() => db.habits.put(updated));
  },

  reorderHabits: (fromId, toId) => {
    const habits = [...get().habits].sort((a, b) => a.order - b.order);
    const fromIdx = habits.findIndex((h) => h.id === fromId);
    const toIdx = habits.findIndex((h) => h.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = habits.splice(fromIdx, 1);
    habits.splice(toIdx, 0, moved);
    const reordered = habits.map((h, i) => ({ ...h, order: i }));
    set({ habits: reordered });
    safeWrite(() => db.habits.bulkPut(reordered));
  },

  toggleHabit: (date, habitId) => {
    const id = habitEntryId(date, habitId);
    const existing = get().habitEntries.find((e) => e.id === id);
    if (existing) {
      set({ habitEntries: get().habitEntries.filter((e) => e.id !== id) });
      safeWrite(() => db.habitEntries.delete(id));
      return;
    }
    const entry: HabitEntry = { id, date, habitId };
    set({ habitEntries: [...get().habitEntries, entry] });
    safeWrite(() => db.habitEntries.put(entry));
  },

  habitsDoneOn: (date) =>
    get()
      .habitEntries.filter((e) => e.date === date)
      .map((e) => e.habitId),

  reorderSlots: (fromId, toId) => {
    const slots = [...get().slots].sort((a, b) => a.rotationOrder - b.rotationOrder);
    const fromIdx = slots.findIndex((s) => s.id === fromId);
    const toIdx = slots.findIndex((s) => s.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = slots.splice(fromIdx, 1);
    slots.splice(toIdx, 0, moved);
    const reordered = slots.map((s, i) => ({ ...s, rotationOrder: i }));
    set({ slots: reordered });
    safeWrite(() => db.slots.bulkPut(reordered));
  },

  importData: async (data) => {
    // Write to IndexedDB first — replaceAllData is one Dexie transaction, so
    // a failure partway through rejects and rolls everything back. Only once
    // that succeeds do we swap the in-memory store, so a DB failure leaves
    // both existing IndexedDB data AND the live UI state untouched.
    await replaceAllData(data);
    set({
      exercises: data.exercises,
      slots: data.slots,
      sessions: data.sessions,
      sets: data.sets,
      dailyLogs: data.dailyLogs,
      habits: data.habits,
      habitEntries: data.habitEntries,
      targetProfiles: data.targetProfiles,
      weekdayTargets: data.weekdayTargets,
      targetsEnabled: data.targetsEnabled,
      habitsEnabled: data.habitsEnabled,
      toolsEnabled: data.toolsEnabled,
      unit: data.unit,
      chartsEnabled: true,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  clearAllData: async () => {
    // Reuse the atomic replace: wipe every table, then write back only the
    // exercise preset library with empty history and default settings. Keeping
    // the presets means the DB is not "empty", so hydrate() won't re-seed the
    // demo history on the next load — the clean slate persists.
    const targets = defaultTargets();
    await replaceAllData({
      version: BACKUP_VERSION,
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      habits: [],
      habitEntries: [],
      ...targets,
      targetsEnabled: false,
      habitsEnabled: false,
      toolsEnabled: false,
      unit: "lbs",
    });
    set({
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      habits: [],
      habitEntries: [],
      ...targets,
      targetsEnabled: false,
      habitsEnabled: false,
      toolsEnabled: false,
      unit: "lbs",
      chartsEnabled: true,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  suggestedNextExerciseFor: (sessionId) =>
    suggestNextExercise(get().sessions, get().sets, sessionId),

  prefillFor: (sessionId, exerciseId) =>
    computePrefill(get().sessions, get().sets, sessionId, exerciseId),

  lastSetupNoteFor: (exerciseId) => {
    const mostRecentWithNote = get()
      .sets.filter((s) => s.exerciseId === exerciseId && s.setupNote?.trim())
      .sort((a, b) => b.loggedAt - a.loggedAt)[0];
    return (
      mostRecentWithNote?.setupNote ?? get().exercises.find((e) => e.id === exerciseId)?.setupNote
    );
  },

  dismissWriteError: () => set({ writeFailed: false }),
}));

// Registered at module scope so any failed IndexedDB write (from db.ts's
// safeWrite) surfaces as store state. db.ts cannot import this module back
// (store.ts already imports db.ts — that would be circular), so it exposes
// this setter instead. SSR-safe: this only assigns a function reference and
// never touches IndexedDB itself.
setWriteErrorHandler(() => {
  useStore.setState({ writeFailed: true });
});
