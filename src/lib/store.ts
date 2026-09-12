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
import {
  plannedWorkoutFor,
  prunePlannedWorkout,
  emptyPlannedWeek,
  type PlannedWeek,
  type PlannedWorkout,
} from "./plan";
import { targetProfileFor, type GoalMode } from "./targets";
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
  /**
   * Whether the user is cutting, maintaining or gaining, which is what decides
   * per field whether going OVER is a win or a miss (see `directionFor`).
   *
   * Optional, and absent means `maintain`, resolved on read — never stamped
   * onto stored data. Every profile saved before this field existed therefore
   * behaves sensibly with no migration, and because it is a non-indexed field
   * it needs no Dexie version bump either (see the note in db.ts).
   */
  goalMode?: GoalMode;
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
  targetProfiles: TargetProfile[];
  weekdayTargets: string[];
  targetsEnabled: boolean;
  toolsEnabled: boolean;
  planEnabled: boolean;
  /**
   * The weekly training plan, or `undefined` for a file written before planning
   * existed and for anyone who has never planned a day.
   *
   * REQUIRED, and spelled `| undefined` rather than `?:`, which is the whole
   * point of it. A required key is what keeps the `const backup: BackupData`
   * annotation in settings.tsx a compile error every time this interface
   * widens; an optional one type-checks happily against an export that never
   * mentions the field, so exports would keep writing plan-less files and the
   * only symptom would be a restored backup with the plan gone. TypeScript
   * still demands the key be written out when the type includes `undefined`,
   * so the guard survives while the union keeps the distinction plan.ts draws
   * between "never planned" and "seven explicit rest days".
   */
  plannedWeek: PlannedWeek | undefined;
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
 * simply lands with no habits and a single uniform target profile.
 *
 * The weekly plan (`planEnabled` / `plannedWeek`) rides along on v4 rather than
 * forcing a v5. It is read exactly as tolerantly as the rest of v4, so a file
 * written before planning existed still imports and lands with no plan, and a
 * version bump would buy nothing: no reader branches on the number, and the
 * one that reports it to the user reads it off the file. */
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
  /** Feature toggles for the four opt-in additions. Off by default: each one
   * adds a surface to a screen whose whole point is having nothing in the way,
   * so the user turns them on deliberately. */
  targetsEnabled: boolean;
  toolsEnabled: boolean;
  planEnabled: boolean;
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  dailyLogs: DailyLog[];
  targetProfiles: TargetProfile[];
  /** 7 profile ids, MONDAY FIRST. Resolve through targets.ts, never `getDay()`. */
  weekdayTargets: string[];
  /**
   * The weekly training plan, 7 entries MONDAY FIRST, or undefined when the user
   * has never planned anything. Resolve through plan.ts, never `getDay()`.
   *
   * Optional rather than seeded with a week of rest days, unlike
   * `weekdayTargets`: targets ship pre-filled because an empty targets editor is
   * useless, whereas an unplanned week is a real and permanent state for a user
   * who never turns planning on, and writing seven nulls into everyone's
   * settings row to represent it would be storage for nothing.
   */
  plannedWeek?: PlannedWeek;
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
  setToolsEnabled: (v: boolean) => void;
  setPlanEnabled: (v: boolean) => void;

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

  // --- Planned workouts --------------------------------------------------
  /** Sets one weekday's plan, `weekdayIndex` MONDAY-FIRST (0 = Monday). `null`
   * makes it a rest day. Creates the week on first use, so the caller never has
   * to initialise it. */
  setPlannedDay: (weekdayIndex: number, workout: PlannedWorkout | null) => void;
  /** The workout planned for a "yyyy-MM-dd" day key, with any exercise that no
   * longer exists dropped, or undefined when nothing is planned. This is what
   * `startWorkout` preloads from; it never constrains accessories. */
  plannedWorkoutForDate: (date: string) => PlannedWorkout | undefined;

  reorderSlots: (fromId: string, toId: string) => void;
  /** Full backup restore. Assumes `data` has already been validated by
   * `parseBackup` — replaces IndexedDB first (single transaction; a failure
   * there rejects and leaves both the DB and the in-memory store untouched),
   * then mirrors the same data into the live store and clears any
   * in-progress workout, since a fresh backup has none. */
  importData: (data: BackupData) => Promise<void>;
  /** Wipe all logged data (slots, sessions, sets), reset settings to defaults,
   * and restore the exercise preset library — a clean slate for testing. The
   * preset library is re-seeded so the picker stays usable, which also leaves
   * the result identical to what a genuine first run produces. */
  clearAllData: () => Promise<void>;
  predictedNextSlotName: () => string | undefined;
  suggestedNextExerciseFor: (
    sessionId: string,
  ) => { exerciseId: string; weight?: number; reps?: number; rpe?: number } | undefined;
  /** `knownSetupNote` is the setup about to be performed, for when the log
   * sheet has a note typed but no set logged with it yet. Omit it and the note
   * is read off whatever has already been logged today. */
  prefillFor: (
    sessionId: string,
    exerciseId: string,
    knownSetupNote?: string,
  ) => { weight?: number; reps?: number; rpe?: number };
  /** The setup note to suggest for an exercise, taken from the same session the
   * prefilled numbers came from so the two can never describe different days
   * (see `suggestSetupNote`), falling back to the exercise's base note. Persists
   * across workouts so last week's setup shows up as a grey hint this week. */
  lastSetupNoteFor: (exerciseId: string) => string | undefined;
  /** Clears the write-failure banner. Does not retry the write; the in-memory
   * state is already current, this only dismisses the notice. */
  dismissWriteError: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

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
 * Finds the previous completed occurrence of the same Split Slot as `sess`.
 *
 * This decides ORDER only: which exercise comes back next, in the sequence the
 * slot was last performed in. It deliberately no longer decides WEIGHT. A lift
 * trained on more than one slot (bench on Full Body 1 and again on Full Body 3)
 * moves up on whichever day it was last trained, so the numbers have to come
 * from the last session that actually contains the lift, not from the last
 * session that happens to share a slot. See `findPrefillSource`.
 *
 * Two guards matter here, and both exist because cardio sessions live in this
 * same array. Cardio sessions are excluded outright, and a session with no
 * `splitSlotId` never matches anything, because otherwise two cardio bouts, which
 * BOTH carry `splitSlotId === undefined`, would compare equal to each other and to
 * any other slot-less session, and a treadmill run would start feeding the
 * suggestion engine.
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
 * The comparison key for a setup note, so "bench (tng)" and "bench (pause)"
 * are never treated as the same lift.
 *
 * Trimmed and case-folded, because "TNG", "tng" and " tng " are one setup typed
 * three ways: matching on the exact characters would make the app look like it
 * forgot last week over a stray capital.
 *
 * Absent, empty and whitespace-only all collapse to "", and that empty key is a
 * REAL bucket rather than a wildcard. An un-noted bench must not prefill from a
 * paused bench, and a paused bench must not prefill from an un-noted one: "no
 * note" is a genuine answer ("I just benched"), not a request to match anything
 * available. Letting it match everything is the same class of bug as matching
 * by slot, one setup silently borrowing another setup's numbers.
 *
 * Takes `unknown` because imported backups reach the heuristics with whatever
 * was in the file; a non-string note is treated as no note rather than crashing
 * a prefill.
 */
export function setupNoteKey(note: unknown): string {
  return typeof note === "string" ? note.trim().toLowerCase() : "";
}

/** The identity of a weight/rep block, e.g. "190x3". */
function blockKey(s: WorkoutSet): string {
  return `${s.weight}x${s.reps}`;
}

/** One exercise's sets within one session, oldest first. */
function setsOfExerciseIn(sets: WorkoutSet[], sessionId: string, exerciseId: string): WorkoutSet[] {
  return sets
    .filter((s) => s.sessionId === sessionId && s.exerciseId === exerciseId)
    .sort((a, b) => a.loggedAt - b.loggedAt);
}

/**
 * The single past session that BOTH the prefilled numbers and the suggested
 * setup note are read from.
 *
 * One source is the whole point. When the numbers and the note are looked up
 * independently they can disagree, and the user is shown 80x5 next to a note
 * describing a setup they were not using when they lifted 80x5. Anything the
 * app suggests about "last time" has to describe one real session.
 */
export interface PrefillSource {
  /** The session the numbers and the note both come from. */
  session: WorkoutSession;
  /** Its sets of this exercise, in the matched note bucket, oldest first. Never empty. */
  sets: WorkoutSet[];
  /** The note to suggest, exactly as it was typed. Undefined for the un-noted bucket. */
  setupNote?: string;
  /** The bucket the source was matched on (see `setupNoteKey`). */
  noteKey: string;
}

/**
 * The note bucket the current session has already committed to for this
 * exercise, or undefined when nothing has been logged for it yet today.
 *
 * The most recently logged set wins, because that is the setup currently in
 * use: switching from touch-and-go to paused halfway through a session should
 * immediately start prefilling from paused history, not keep serving up
 * touch-and-go numbers for the rest of the day.
 *
 * Note that a set logged with no note answers "" rather than undefined. Today
 * being un-noted is knowledge too, and it restricts the search to un-noted
 * history rather than opening it up to everything.
 */
export function currentNoteKeyFor(
  sets: WorkoutSet[],
  sessionId: string,
  exerciseId: string,
): string | undefined {
  const today = setsOfExerciseIn(sets, sessionId, exerciseId);
  const last = today[today.length - 1];
  return last === undefined ? undefined : setupNoteKey(last.setupNote);
}

/**
 * Picks the source session: the most recent COMPLETED session that actually
 * contains this exercise, regardless of which Split Slot it belonged to.
 *
 * The bug this replaces: sourcing by slot meant a lift trained twice a week
 * only ever saw its own weekday. Push 70x5 on Full Body 1, push 80x5 on Full
 * Body 3, and the next Full Body 1 still prefilled 70x5, permanently a week
 * stale on every lift trained more than once a week.
 *
 * Setup notes then narrow the search:
 *
 * - With a note known for today (`knownSetupNote`, or whatever today's sets
 *   already say), only sessions containing this exercise in that same bucket
 *   qualify. A session that contains the exercise under a different setup is
 *   skipped entirely and an older matching session is used instead, since
 *   week-old numbers for the right setup beat fresh numbers for the wrong one.
 * - With nothing known yet, which is the common case on the first set of the
 *   day, the most recent session containing the exercise wins and its OWN note
 *   decides the bucket. The bucket is taken from that session's earliest set of
 *   the exercise, because with nothing logged today the prefill being asked for
 *   is the first block, and the earliest set is how that session opened.
 *
 * Cardio is excluded on both sides: a cardio session is never a source, and
 * asking on behalf of one gets nothing back. Cardio carries no sets, so a
 * matching set only ever exists on one through a hand-edited or malformed
 * import, which is exactly when the guard has to hold.
 */
export function findPrefillSource(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string,
  exerciseId: string,
  knownSetupNote?: string,
): PrefillSource | undefined {
  const sess = sessions.find((s) => s.id === sessionId);
  if (!sess || isCardioSession(sess)) return undefined;

  // An explicit note (the one being typed into the log sheet, before any set
  // exists to read it off) outranks what today's sets say, because it is the
  // setup about to be performed.
  const wantedKey =
    knownSetupNote === undefined
      ? currentNoteKeyFor(sets, sessionId, exerciseId)
      : setupNoteKey(knownSetupNote);

  // `endedAt` keeps an unfinished session out: only a session that was actually
  // completed is "last time". The slot is not consulted at all, so a session
  // with no slot at all (malformed import) is still honest history and can
  // still be a source; unlike slot matching, exercise matching cannot confuse
  // two slot-less sessions for each other.
  const candidates = sessions
    .filter((s) => !isCardioSession(s) && s.id !== sessionId && s.endedAt)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || b.startedAt - a.startedAt);

  for (const candidate of candidates) {
    const all = setsOfExerciseIn(sets, candidate.id, exerciseId);
    if (all.length === 0) continue;
    const noteKey = wantedKey ?? setupNoteKey(all[0].setupNote);
    const matching = all.filter((s) => setupNoteKey(s.setupNote) === noteKey);
    // Wrong setup in this session: keep walking back rather than settling.
    if (matching.length === 0) continue;
    // Every set here shares one key, so the freshest spelling of it is as good
    // as any and better than a stale one.
    const noted = [...matching].reverse().find((s) => setupNoteKey(s.setupNote) !== "");
    return { session: candidate, sets: matching, setupNote: noted?.setupNote, noteKey };
  }
  return undefined;
}

/**
 * The setup note to suggest for an exercise, kept in lockstep with the numbers
 * `computePrefill` returns by reading both from `findPrefillSource`.
 *
 * When the source session was un-noted the answer is undefined, NOT the last
 * note found anywhere. Reaching further back for a note the source session did
 * not have is precisely how a note ends up describing a different session than
 * the weights beside it.
 *
 * The scan of every set is the fallback for having no source at all: no workout
 * open (the cardio card asks this way), or an exercise whose only history is in
 * the session currently in progress.
 */
export function suggestSetupNote(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string | undefined,
  exerciseId: string,
): string | undefined {
  if (sessionId !== undefined) {
    const source = findPrefillSource(sessions, sets, sessionId, exerciseId);
    if (source) return source.setupNote;
  }
  return sets
    .filter((s) => s.exerciseId === exerciseId && setupNoteKey(s.setupNote) !== "")
    .sort((a, b) => b.loggedAt - a.loggedAt)[0]?.setupNote;
}

/**
 * "Next Exercise" suggestion.
 *
 * WHICH exercise comes next is a property of the slot: it walks the last
 * occurrence of the SAME Split Slot in the order things were logged that day,
 * skipping whatever is already done today. That rotation is the shape of the
 * program and is left alone.
 *
 * The numbers attached to it are not a property of the slot, so they come from
 * `findPrefillSource` like every other prefill. The suggested exercise is by
 * definition not yet logged today, so its first block is the one being offered,
 * which is what `computePrefill` would return for it as well.
 *
 * Strength-only: cardio sessions are neither a source nor a target.
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
  // Last strength session of this slot (excluding current), for ORDER only.
  const lastSess = findLastSessionForSlot(sessions, sess);
  if (!lastSess) return undefined;
  const setsInLast = sets
    .filter((s) => s.sessionId === lastSess.id)
    .sort((a, b) => a.loggedAt - b.loggedAt);
  const order: string[] = [];
  for (const s of setsInLast) if (!order.includes(s.exerciseId)) order.push(s.exerciseId);
  const next = order.find((id) => !doneExerciseIds.has(id));
  if (!next) return undefined;
  const firstBlock = findPrefillSource(sessions, sets, sessionId, next)?.sets[0];
  return {
    exerciseId: next,
    weight: firstBlock?.weight,
    reps: firstBlock?.reps,
    rpe: firstBlock?.rpe,
  };
}

/**
 * Distinct-weight-block matching: the Nth distinct weight/rep block logged for
 * an exercise today prefills from the Nth distinct weight/rep block of that
 * exercise in the source session, so a top single followed by backdown triples
 * comes back as a top single followed by backdown triples.
 *
 * Only WHERE the blocks are read from changed: `findPrefillSource` picks the
 * last session that really contains this exercise (and this setup), where it
 * used to be the last session sharing a Split Slot.
 *
 * Both sides of the count are confined to the source's note bucket. Today's
 * paused sets are counted against the source's paused blocks and nothing else,
 * so switching setup mid-session starts that setup's blocks from the top
 * instead of resuming at whatever index the other setup had reached.
 *
 * Strength-only: cardio sessions are neither a source nor a target.
 */
export function computePrefill(
  sessions: WorkoutSession[],
  sets: WorkoutSet[],
  sessionId: string,
  exerciseId: string,
  knownSetupNote?: string,
): { weight?: number; reps?: number; rpe?: number } {
  const source = findPrefillSource(sessions, sets, sessionId, exerciseId, knownSetupNote);
  if (!source) return {};
  const setsToday = sets.filter(
    (s) =>
      s.sessionId === sessionId &&
      s.exerciseId === exerciseId &&
      setupNoteKey(s.setupNote) === source.noteKey,
  );
  const distinctToday = new Set(setsToday.map(blockKey)).size;
  const distinctBlocks: WorkoutSet[] = [];
  const seen = new Set<string>();
  for (const s of source.sets) {
    const k = blockKey(s);
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

/** One stored entry of a planned week: a rest day, or a workout with a name and
 * a list of exercise ids. Mirrors what plan.ts is prepared to resolve, so a week
 * that passes here cannot land in the store and then read as "no plan". Ids are
 * NOT checked against the exercise library: an id can go stale long after an
 * import, which is exactly why `prunePlannedWorkout` exists at read time. */
function isPlannedDay(v: unknown): v is PlannedWorkout | null {
  if (v === null) return true;
  if (!isPlainObject(v)) return false;
  if (typeof v.name !== "string") return false;
  return Array.isArray(v.exerciseIds) && v.exerciseIds.every((id) => typeof id === "string");
}

/** The whole-week check, carrying the same length rule `weekdayTargets` gets and
 * for the same reason: plan.ts treats any array that is not exactly 7 long as no
 * plan at all, so a malformed one has to be replaced with "no plan" outright
 * rather than stored and then silently ignored on every screen that reads it. */
function isPlannedWeek(v: unknown): v is PlannedWeek {
  return Array.isArray(v) && v.length === 7 && v.every(isPlannedDay);
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

/**
 * A set that could have actually been performed.
 *
 * `typeof v === "number"` was too weak to be a guard here. It admits NaN,
 * Infinity, -45 and 0 reps, and every one of those reaches arithmetic with no
 * defence of its own: `volumeFor` sums weights, chart-math scales axes by them,
 * and pr.ts compares them to decide what to congratulate the user for. NaN is
 * the most damaging because it is the quietest. It has no bad-looking value to
 * notice, it propagates through any total that touches it, and one corrupt row
 * therefore blanks a whole chart rather than one point on it. Infinity is worse
 * on the record axes, where it wins every comparison forever.
 *
 * Rejecting the FILE rather than dropping the row is deliberate and follows
 * what `parseBackup` already promises: a key that is present but malformed is a
 * hard failure. Quietly importing 9 of 10 sets would leave the user believing
 * they had restored a history they no longer have, which is the one outcome a
 * backup feature must never produce.
 *
 * Two limits are deliberately NOT symmetric. A weight of 0 is legitimate and
 * kept: a pull-up, a dip or a bodyweight squat is a real set with no load, and
 * rejecting it would refuse honest files. 0 reps is not, because a set of no
 * reps is a set that did not happen; reps must also be whole, since half a rep
 * is not something the logger can produce and not something a chart can mean.
 */
function isWorkoutSet(v: unknown): v is WorkoutSet {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  // Empty ids parse but point at nothing, leaving a set that belongs to no
  // session and no exercise and so can never be displayed or compared.
  if (typeof v.sessionId !== "string" || v.sessionId.length === 0) return false;
  if (typeof v.exerciseId !== "string" || v.exerciseId.length === 0) return false;
  if (!isFiniteNumber(v.weight) || v.weight < 0) return false;
  if (typeof v.reps !== "number" || !Number.isInteger(v.reps) || v.reps <= 0) return false;
  if (!isOptionalFiniteNumber(v.rpe)) return false;
  if (v.isDropsetOrPartial !== undefined && typeof v.isDropsetOrPartial !== "boolean") return false;
  if (v.setupNote !== undefined && typeof v.setupNote !== "string") return false;
  // Finite, but deliberately NOT required to be positive, which is the one place
  // this guard is looser than the rest. `logSet` computes it as a difference
  // between two clock readings, so a device whose clock corrects backwards mid
  // session (NTP, a timezone change) writes a negative rest time on its own.
  // Refusing the file would then reject a backup the app itself produced, over a
  // number that only ever gets displayed. A NaN is still worth catching, since
  // it silently poisons rest-time averages the way a NaN weight poisons volume.
  if (!isOptionalFiniteNumber(v.timeBetweenSetsSeconds)) return false;
  if (v.blockGroupId !== undefined && typeof v.blockGroupId !== "string") return false;
  // Every ordering in the app sorts on this. A NaN never compares true, so one
  // would scramble the order of a session rather than merely misplace one set.
  if (!isFiniteNumber(v.loggedAt)) return false;
  return true;
}

function isOptionalNumber(v: unknown): boolean {
  return v === undefined || typeof v === "number";
}

/** A stored measurement: a real number, never NaN and never Infinity. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isOptionalFiniteNumber(v: unknown): boolean {
  return v === undefined || isFiniteNumber(v);
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
  const rawPlannedWeek = (parsed as { plannedWeek?: unknown }).plannedWeek;
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
      targetProfiles,
      weekdayTargets: safeWeekdays,
      targetsEnabled: (parsed as { targetsEnabled?: unknown }).targetsEnabled === true,
      toolsEnabled: (parsed as { toolsEnabled?: unknown }).toolsEnabled === true,
      planEnabled: (parsed as { planEnabled?: unknown }).planEnabled === true,
      // Anything that is not a well-formed week becomes "no plan" rather than an
      // import failure, matching how the file's targets and habits degrade: a
      // hand-edited plan is not worth refusing someone their six weeks of sets
      // over. A file that never had the key takes this same branch, which is the
      // whole of what a pre-plan backup needs.
      plannedWeek: isPlannedWeek(rawPlannedWeek) ? rawPlannedWeek : undefined,
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
    toolsEnabled: s.toolsEnabled,
    targetProfiles: s.targetProfiles,
    weekdayTargets: s.weekdayTargets,
    planEnabled: s.planEnabled,
    plannedWeek: s.plannedWeek,
  };
  safeWrite(() => db.meta.put(settings));
}

export const useStore = create<State>((set, get) => ({
  unit: "lbs",
  chartsEnabled: true,
  targetsEnabled: false,
  toolsEnabled: false,
  planEnabled: false,
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
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
          toolsEnabled: false,
          ...targets,
        };
        // A first run seeds the exercise NAME library and nothing else. The
        // library is reference data the picker needs to be usable on day one;
        // slots, sessions and sets are the user's own record of what they did,
        // and inventing any of those would show someone a training history they
        // never had. An empty log is the honest state of a new install.
        await seedDb({
          exercises: seedExercises,
          slots: [],
          sessions: [],
          sets: [],
          settings,
        });
        set({
          exercises: seedExercises,
          slots: [],
          sessions: [],
          sets: [],
          dailyLogs: [],
          unit: settings.unit,
          chartsEnabled: true,
          targetsEnabled: false,
          toolsEnabled: false,
          // Not written into the seeded settings record above, only into state:
          // absent already means "off, nothing planned" on read, so stamping
          // the default onto storage would buy nothing (same call as `goalMode`).
          planEnabled: false,
          plannedWeek: undefined,
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
        unit: data.settings.unit,
        chartsEnabled: data.settings.chartsEnabled ?? true,
        targetsEnabled: data.settings.targetsEnabled ?? false,
        toolsEnabled: data.settings.toolsEnabled ?? false,
        targetProfiles: data.settings.targetProfiles ?? defaultTargets().targetProfiles,
        weekdayTargets: data.settings.weekdayTargets ?? defaultTargets().weekdayTargets,
        // Both default on READ. A settings record written before planning
        // existed has neither key, and no migration is needed to make it mean
        // "no plan" (see the note on `plannedWeek` in db.ts).
        planEnabled: data.settings.planEnabled ?? false,
        plannedWeek: data.settings.plannedWeek,
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

  /**
   * Changes the LABEL every weight is shown with. It converts nothing, and that
   * is a known hazard rather than an oversight.
   *
   * No unit is recorded on a `WorkoutSet`, so a 100 logged in kg and a 225
   * logged in lbs sit in one history as bare numbers. 225 lb IS 102 kg, a
   * rounding error of a gain, but anything comparing the two reads a 125-unit
   * jump. That reaches progress charts, `bestSetFor`, and pr.ts, which would
   * announce an all-time weight record for changing a setting. The same applies
   * to `DailyLog.bodyweight` and to cardio `distance`, which is miles or km on
   * the same switch and so converts by a different factor again.
   *
   * Both available fixes were weighed and neither is safe to land piecemeal:
   *
   * - CONVERTING stored weights on switch is the only one that repairs an
   *   existing mixed history, and it is the more dangerous of the two. It
   *   rewrites every number the user typed. `safeWrite` swallows a failed write
   *   by design (the in-memory state has already won), so a conversion that
   *   fails partway leaves rows in two units with nothing marking which moved.
   *   It is also lossy and therefore not reversible: 100 kg reads back as
   *   220.5 lb and returns as 100.017 kg, so a user who toggles the setting to
   *   look at something walks their whole history a little each time.
   * - STAMPING `unit` onto each set at log time is additive, never rewrites a
   *   stored number, is exactly reversible, and needs no Dexie bump, since a
   *   non-indexed field round-trips through the current schema (see db.ts).
   *   It is the better design and it is what should eventually happen. But it
   *   only fixes anything once every READER converts, and the readers are in
   *   pr.ts, exercise-history.ts, chart-math.ts, csv.ts and six screens.
   *   Stamped but unread, the field would make the data look authoritative
   *   while leaving it exactly as wrong, which is the worse failure: the next
   *   person to build on it would have every reason to trust it.
   *
   * Neither recovers what unit an EXISTING set was logged in. That was never
   * written down and is not derivable. The only guess available is "whatever
   * the global unit is now", and leaving that guess implicit is more honest
   * than back-filling it into storage, where it would read as a recorded fact.
   *
   * So this stays as it is, deliberately, until the reader-side conversion can
   * land with it in one piece. unit-switch.test.ts pins the behaviour so the
   * change cannot be made by halves.
   */
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

  setToolsEnabled: (v) => {
    set({ toolsEnabled: v });
    persistSettingsFrom(get());
  },

  setPlanEnabled: (v) => {
    set({ planEnabled: v });
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

  // --- Planned workouts --------------------------------------------------

  setPlannedDay: (weekdayIndex, workout) => {
    if (weekdayIndex < 0 || weekdayIndex > 6) return;
    // Rebuilt from an empty week whenever what is stored is not a well-formed
    // one, so a hand-edited backup with a 5-entry array is repaired by the first
    // edit instead of being written back one day longer and still broken.
    const current = get().plannedWeek;
    const next = Array.isArray(current) && current.length === 7 ? [...current] : emptyPlannedWeek();
    next[weekdayIndex] = workout;
    set({ plannedWeek: next });
    persistSettingsFrom(get());
  },

  plannedWorkoutForDate: (date) =>
    prunePlannedWorkout(
      plannedWorkoutFor(date, get().plannedWeek),
      get().exercises.map((e) => e.id),
    ),

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
      targetProfiles: data.targetProfiles,
      weekdayTargets: data.weekdayTargets,
      targetsEnabled: data.targetsEnabled,
      toolsEnabled: data.toolsEnabled,
      unit: data.unit,
      chartsEnabled: true,
      // Restored from the file, not cleared. `replaceAllData` has just written
      // both of these into the settings record, so anything else here would
      // leave the store disagreeing with the DB until the next reload quietly
      // corrected it. A file with no plan carries `undefined`, which lands the
      // reader on "never planned" - the same state the file's author was in.
      planEnabled: data.planEnabled,
      plannedWeek: data.plannedWeek,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  clearAllData: async () => {
    // Reuse the atomic replace: wipe every table, then write back only the
    // exercise preset library with empty history and default settings. That is
    // exactly the state a first run lands in, so "clear data" and a fresh
    // install are the same thing rather than two subtly different starts.
    const targets = defaultTargets();
    await replaceAllData({
      version: BACKUP_VERSION,
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      ...targets,
      targetsEnabled: false,
      toolsEnabled: false,
      planEnabled: false,
      plannedWeek: undefined,
      unit: "lbs",
    });
    set({
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      ...targets,
      targetsEnabled: false,
      toolsEnabled: false,
      unit: "lbs",
      chartsEnabled: true,
      planEnabled: false,
      plannedWeek: undefined,
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  suggestedNextExerciseFor: (sessionId) =>
    suggestNextExercise(get().sessions, get().sets, sessionId),

  prefillFor: (sessionId, exerciseId, knownSetupNote) =>
    computePrefill(get().sessions, get().sets, sessionId, exerciseId, knownSetupNote),

  lastSetupNoteFor: (exerciseId) => {
    // Scoped to the open workout so the hint and the prefilled numbers come off
    // one session. With no workout open there is no source to agree with, and
    // suggestSetupNote falls back to the most recent note logged anywhere.
    const suggested = suggestSetupNote(
      get().sessions,
      get().sets,
      get().activeSessionId,
      exerciseId,
    );
    // The exercise's own note is a property of the exercise rather than of any
    // session, so it stays the last resort for a lift never logged with a note.
    return suggested ?? get().exercises.find((e) => e.id === exerciseId)?.setupNote;
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
