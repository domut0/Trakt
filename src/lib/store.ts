import { create } from "zustand";
import {
  db,
  isDbEmpty,
  isIndexedDbAvailable,
  loadAll,
  replaceAllData,
  safeWrite,
  seedDb,
  setWriteErrorHandler,
  deleteTemplateRecord,
  saveTemplateRecord,
  type ActiveSessionMeta,
  type SettingsMeta,
  type WorkoutTemplate,
} from "./db";
import { dayKey, isDailyLogEmpty, parseDayKey } from "./daily-log";
import {
  cardForWeekday,
  convertSplit,
  advanceSplit,
  firstDayCard,
  kindOf,
  orderedSplit,
  isNutritionPhase,
  isPlannedDay,
  phaseForDate,
  isUntrackedOn,
  pinnedSlotIdFor,
  targetsForDate,
  type NutritionPhase,
  type PlannedDay,
  type SplitCardKind,
} from "./planning";
import { seedExercises } from "./exercise-library";
import { resolvePlan, type PlanLift, type PlanningMode, type PlanPayload } from "./plan-tab";

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
  /**
   * What this card is in the split.
   *
   * Absent means `workout`, so every slot written before the split existed
   * needs no migration. A `rest` is still a day - it is spent, and spending it
   * moves the cursor on - while a `repeat` is not a day at all: reaching one
   * sends the cursor back to the top, which is what lets five cards express
   * "Upper, Lower, forever, with a rest when I say so".
   *
   * Only a `workout` can own a session. `startWorkout` never matches against a
   * rest or a repeat, so neither can end up as a thing sets were logged into.
   */
  kind?: SplitCardKind;
  /**
   * Which weekday this card is on, 0 = Sunday, in `week` planning mode.
   *
   * Absent in `rotation` mode, where the split advances when you train and a
   * weekday would be a lie. Non-indexed, so no Dexie version bump.
   */
  weekday?: number;
  /**
   * The lifts this slot is for, which is where a training plan actually lives.
   *
   * It used to hang off a WEEKDAY, which cannot express UL×infinity: that split
   * advances when you train rather than when the date changes, so there is no
   * week to attach it to. On the slot it works for any cycle length - two slots
   * for UL, three for PPL, six for a body-part split - and rest days need no
   * representation at all, because the rotation has no dates in it.
   *
   * Preloaded by startWorkout, and never a constraint: nothing filters what else
   * can be logged once the workout is running.
   */
  plannedLifts?: PlannedLift[];
}

/**
 * One prescribed lift: which exercise, and optionally how much of it.
 *
 * Every field but the exercise is optional, and a lift with none is what the
 * app had before prescriptions existed: a name in an order. `reps` and `load`
 * are strings because programmes are written as "8-12" and "RPE 8" as often as
 * they are written as numbers, and a field that cannot hold those makes the
 * coach round their own programme to fit the app.
 */
export interface PlannedLift {
  exerciseId: string;
  sets?: number;
  reps?: string;
  load?: string;
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
  /**
   * The card's name, copied here when the card itself is deleted.
   *
   * A card with history is removed from the split, not from the record:
   * without this, every session logged against a dropped "Legs" would read
   * "Untitled" in History and blank in the sheet. `splitSlotId` is left
   * pointing at the dead id rather than cleared, so nothing that already
   * treats "has no slot" as cardio starts treating these as cardio.
   * Non-indexed, so no Dexie version bump.
   */
  slotName?: string;
}

/** What to call a strength session: its card, or the card it had when that was deleted. */
export function sessionSlotName(
  session: WorkoutSession,
  slots: readonly SplitSlot[],
): string | undefined {
  if (session.splitSlotId == null) return undefined;
  return slots.find((sl) => sl.id === session.splitSlotId)?.name ?? session.slotName;
}

/**
 * Stamps the dropped cards' names onto the sessions logged against them.
 * Returns only the sessions it changed, so the caller writes nothing else.
 */
export function rememberSlotNames(
  sessions: readonly WorkoutSession[],
  dropped: readonly SplitSlot[],
): WorkoutSession[] {
  const names = new Map(dropped.map((sl) => [sl.id, sl.name]));
  return sessions.flatMap((session) => {
    const name = session.splitSlotId == null ? undefined : names.get(session.splitSlotId);
    return name !== undefined && session.slotName === undefined
      ? [{ ...session, slotName: name }]
      : [];
  });
}

/** `sessions` with `changed` swapped in by id. */
function withSessions(
  sessions: WorkoutSession[],
  changed: readonly WorkoutSession[],
): WorkoutSession[] {
  if (changed.length === 0) return sessions;
  const byId = new Map(changed.map((s) => [s.id, s]));
  return sessions.map((s) => byId.get(s.id) ?? s);
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
  isUntracked?: boolean;
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

/** The shape produced by Settings' "Export backup" action, and the shape
 * `importData` / `replaceAllData` expect back in. Kept flat (no meta
 * nesting) to match the exported JSON exactly.
 *
 * `version` tracks the backup format, not the app: v1 files predate daily
 * logging and have neither key. `parseBackup` reads both tolerantly. */
export interface BackupData {
  version: number;
  exercises: Exercise[];
  /**
   * Reusable cards. In the backup because they are written once and reused for
   * years, and losing a phone should not cost them; a file written before they
   * existed simply has none.
   */
  templates: WorkoutTemplate[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  dailyLogs: DailyLog[];
  nutritionPhases: NutritionPhase[];
  plannedDays: PlannedDay[];
  /**
   * The split cursor, or `undefined` for a file written before the split
   * existed - which reads as "start at the top", and is correct.
   *
   * REQUIRED, and spelled `| undefined` rather than `?:`, which is the whole
   * point of it. A required key keeps the `const backup: BackupData` annotation
   * in settings.tsx a compile error every time this interface widens; an
   * optional one type-checks happily against an export that never mentions the
   * field, so exports would keep writing files without it and the only symptom
   * would be a restore that silently reset your place in the split. TypeScript
   * still demands the key be written out when the type includes `undefined`, so
   * the guard survives while the union keeps the meaning.
   */
  nextSlotId: string | undefined;
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
export const BACKUP_VERSION = 6;

interface State {
  unit: "lbs" | "kg";
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  dailyLogs: DailyLog[];
  nutritionPhases: NutritionPhase[];
  plannedDays: PlannedDay[];
  /**
   * The card the split is pointing at: what you do next.
   *
   * A real stored cursor, which the rotation this replaced deliberately did not
   * have - it derived "next" from whichever slot was logged most recently, so
   * nothing could desynchronise. That stops working the moment the split holds
   * cards you never log: a rest is consumed by choosing it, a repeat is never
   * consumed at all, so something has to remember the position.
   *
   * It moves when a card is CONSUMED - a workout ended, a rest taken - never
   * when the date changes. Skipping a day costs nothing: Monday's Upper is
   * still waiting on Wednesday.
   */
  nextSlotId: string | undefined;
  /**
   * The day the current REST card became current, as a day key.
   *
   * The one exception to the paragraph above. A rest is not consumed by doing
   * anything - that is what a rest is - so it is the only card the CLOCK can
   * spend, and it is spent at the first midnight after it was taken. Recording
   * the day it started is what makes that decidable without a background task:
   * any time the app opens, "is today later than this" is the whole question.
   *
   * Undefined whenever the cursor is not on a rest.
   */
  restSince: string | undefined;
  /**
   * The `issuedAt` of the coach plan currently in force, or undefined when no
   * coach plan has ever been accepted.
   *
   * What makes re-reading the plan tab on every sync idempotent: a plan is
   * offered only when it is newer than this. See `isNewerCoachPlan`.
   */
  lastAcceptedPlanAt: string | undefined;
  /** See `SettingsMeta.coachManaged`. */
  coachManaged: boolean;
  /**
   * How the split is arranged.
   *
   * `week` is the default for anyone starting now: seven days, each holding a
   * card. `rotation` is the consumable-card cycle - Upper, Lower, Repeat -
   * which advances when you train and has no weekdays in it. Part of the plan,
   * so a coach sets it per client and it travels in the plan tab.
   */
  planningMode: PlanningMode;
  setPlanningMode: (mode: PlanningMode) => void;
  /** Puts a card on a weekday in `week` mode, or takes it off with undefined. */
  setCardWeekday: (slotId: string, weekday: number | undefined) => void;
  /**
   * Reusable cards, kept as NAMES rather than exercise ids.
   *
   * Not swapped in coach mode: a template belongs to whoever wrote it, and
   * the point of one is to drop it into a client's plan.
   */
  templates: WorkoutTemplate[];
  /** Saves a card as a template, under its own name unless given another. */
  saveTemplateFrom: (slotId: string, name?: string) => WorkoutTemplate | undefined;
  deleteTemplate: (id: string) => void;
  /**
   * Writes a template's lifts onto a card, creating any exercise this device
   * has never heard of - the same name-resolution a coach's plan goes through.
   */
  applyTemplate: (templateId: string, slotId: string) => void;
  activeSessionId?: string;
  currentExerciseId?: string;
  /** True once the client-side IndexedDB load (or first-run seed) has completed. */
  hydrated: boolean;
  /** True when the most recent IndexedDB write failed. Ephemeral UI state only:
   * never persisted, never included in a backup. */
  writeFailed: boolean;

  /** Client-only. Loads persisted state from IndexedDB, seeding it on first-ever run. Idempotent. */
  hydrate: () => Promise<void>;
  /**
   * Starts a workout, optionally on a day that has already happened.
   *
   * `on` is a day key. A workout you forgot to log is the ordinary case -
   * you train, you shower, you remember at nine - and the alternative was a
   * second logging screen for past workouts, which would drift from this one.
   */
  startWorkout: (slotName: string, on?: string) => string;
  endWorkout: () => void;
  setCurrentExercise: (exerciseId: string) => void;
  addExercise: (name: string, type: ExerciseType) => Exercise;
  logSet: (input: {
    exerciseId: string;
    weight: number;
    reps: number;
    rpe?: number;
    setupNote?: string;
  }) => void;
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

  /** Free-text note on a whole session. */
  updateSession: (sessionId: string, patch: Pick<WorkoutSession, "note">) => void;

  // --- Nutrition phases ---------------------------------------------------
  /** Adds a change-point. Returns undefined when `startsOn` is already taken:
   * two phases beginning on one day is a contradiction, not something to settle
   * with a tiebreak nobody would remember. Edit the existing one instead. */
  addPhase: (phase: Omit<NutritionPhase, "id">) => NutritionPhase | undefined;
  updatePhase: (id: string, patch: Partial<Omit<NutritionPhase, "id">>) => void;
  /** Move a change-point. Refuses a date another phase already occupies. */
  setPhaseStart: (id: string, startsOn: string) => boolean;
  deletePhase: (id: string) => void;
  /** The phase in force on a "yyyy-MM-dd" day key, untracked ones included. */
  phaseForDay: (date: string) => NutritionPhase | undefined;
  /** The TARGETS in force, which is undefined on an untracked day as well as on
   * a day before any phase existed. */
  targetsForDay: (date: string) => NutritionPhase | undefined;
  /** Untracked by either route: the logged flag, or a planned untracked phase.
   * The planned half is derived and never written to a DailyLog. */
  isUntrackedDay: (date: string) => boolean;

  // --- The workout split --------------------------------------------------
  /** Appends a card. A repeat needs no name and is never a day. */
  /** Undefined while a coach manages the plan. */
  addSplitCard: (input: { name?: string; kind?: SplitCardKind }) => SplitSlot | undefined;
  updateSplitCard: (id: string, patch: { name?: string; kind?: SplitCardKind }) => void;
  /** Removes a card. If the cursor was on it, the cursor moves on rather than
   * being left pointing at nothing. */
  deleteSplitCard: (id: string) => void;
  /** Moves a card to `toIndex` in cycle order, renumbering the rest. */
  moveSplitCard: (id: string, toIndex: number) => void;
  /** "Do this one next", straight from the split screen. */
  setNextCard: (id: string) => void;
  /**
   * Spend a rest that is over. Called whenever the app might have crossed
   * midnight - on hydrate, on returning to the foreground, and on a timer while
   * it stays open.
   */
  settleRestDay: () => void;
  /** Spend the given rest card: the cursor moves past it, exactly as ending a
   * workout moves past a workout card. */
  takeRestDay: (id: string) => void;
  /** The card the split is pointing at, resolved. Falls back to the first day
   * card when the cursor is unset or stale. */
  nextCard: () => SplitSlot | undefined;

  // --- Training plan ------------------------------------------------------
  /** The lifts a slot is for. Preloaded at Start Workout, never a constraint. */
  /** Replaces a card's prescribed lifts, in the order the workout opens them. */
  setSlotLifts: (slotId: string, lifts: PlannedLift[]) => void;
  /** Pins a slot to one date, for when you do know. Replaces any existing pin
   * on that date, because a day trains one thing. */
  /**
   * Adopts a coach-issued plan wholesale.
   *
   * Replaces the split, the nutrition timeline and the pins in one write. Not
   * expressed as a sequence of the existing add/update/delete actions on
   * purpose: those each write through independently, so a failure part-way
   * would leave the user following half of two plans, which is worse than
   * following either.
   *
   * Logged history is untouched. `resolvePlan` matches cards by name so every
   * session keeps the slot it was logged against.
   */
  acceptCoachPlan: (plan: PlanPayload) => void;
  /**
   * Hands the plan back to its owner. Nothing about the plan changes: the
   * coach's last plan simply becomes theirs to edit. It does not stop the
   * coach seeing the sheet -- only unsharing it in Google Drive does that.
   */
  unlinkCoach: () => void;
  pinDay: (date: string, splitSlotId: string) => void;
  unpinDay: (date: string) => void;
  /** The slot pinned to a date, or undefined. NEVER the rotation's guess: the
   * rotation is not projected forward, because a free choice after a rest day
   * makes the future genuinely unknowable. */
  pinnedSlotFor: (date: string) => SplitSlot | undefined;

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

/** Whether an instant falls on today, by the app's own day boundary. */
function isToday(at: number): boolean {
  return dayKey(new Date(at)) === dayKey(new Date());
}

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
  if (v.isUntracked !== undefined && typeof v.isUntracked !== "boolean") return false;
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

/** A template is a name and a list of named lifts. Anything else is dropped. */
function isWorkoutTemplate(value: unknown): value is WorkoutTemplate {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (!Array.isArray(value.lifts)) return false;
  return value.lifts.every((lift) => isPlainObject(lift) && typeof lift.name === "string");
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
  // A pre-rename file carries isCheatDay where this version reads isUntracked.
  // Mapped here rather than in isDailyLog, because a validator that silently
  // rewrites what it validates is a trap for whoever adds the next field. An
  // export taken before the rename is the only copy of that data the user has,
  // so dropping the flag would lose days they deliberately marked.
  if (Array.isArray(dailyLogs)) {
    for (const log of dailyLogs) {
      if (!isPlainObject(log)) continue;
      if (log.isCheatDay === undefined) continue;
      if (log.isCheatDay === true) log.isUntracked = true;
      delete log.isCheatDay;
    }
  }
  // Absent entirely = a pre-v2 backup, which simply had no daily logs. Present
  // but not a well-formed array = a corrupt file, which is a real error.
  if (dailyLogs !== undefined && (!Array.isArray(dailyLogs) || !dailyLogs.every(isDailyLog))) {
    return { ok: false, error: "The backup's daily logs list is malformed." };
  }
  if (unit !== "lbs" && unit !== "kg") {
    return { ok: false, error: "The backup's unit must be lbs or kg." };
  }
  // The planning tables are read tolerantly rather than validated hard. A file
  // older than this model legitimately has none of them, and one bad row should
  // cost that row rather than the whole import: this JSON is the only backup
  // that exists, so refusing a file is more expensive than ignoring a phase.
  //
  // A file from the weekly-template era carries targetProfiles / weekdayTargets
  // / plannedWeek. They are dropped rather than converted. The Dexie v6 upgrade
  // migrates a LIVE database, where a single profile unambiguously meant "these
  // are my targets"; a backup restore replaces everything wholesale, and
  // inventing a phase timeline out of a weekday table would fabricate dates the
  // file never contained.
  const rawPhases = (parsed as { nutritionPhases?: unknown }).nutritionPhases;
  const rawPins = (parsed as { plannedDays?: unknown }).plannedDays;
  const nutritionPhases = Array.isArray(rawPhases)
    ? (rawPhases.filter(isNutritionPhase) as NutritionPhase[])
    : [];
  // A pin naming a slot the file does not contain would preload a workout from
  // a split that no longer exists, so those are dropped with the same tolerance.
  const slotIds = new Set((slots as SplitSlot[]).map((sl) => sl.id));
  const plannedDays = Array.isArray(rawPins)
    ? (rawPins.filter(isPlannedDay).filter((d) => slotIds.has(d.splitSlotId)) as PlannedDay[])
    : [];

  // Read as tolerantly as the planning tables: a file older than templates
  // has none, and one malformed template should cost that template rather than
  // the whole restore.
  const rawTemplates = (parsed as { templates?: unknown }).templates;
  const templates = Array.isArray(rawTemplates)
    ? (rawTemplates.filter(isWorkoutTemplate) as WorkoutTemplate[])
    : [];

  return {
    ok: true,
    data: {
      templates,
      // No `version` means a v1 file. An unrecognised version is kept as-is and
      // imported anyway rather than rejected.
      version: typeof version === "number" ? version : 1,
      exercises: exercises as Exercise[],
      slots: slots as SplitSlot[],
      sessions: sessions as WorkoutSession[],
      sets: sets as WorkoutSet[],
      dailyLogs: (dailyLogs as DailyLog[] | undefined) ?? [],
      nutritionPhases,
      plannedDays,
      // Tolerated, not required: a file written before the split existed has no
      // cursor, and "start at the top" is the right reading of that.
      nextSlotId:
        typeof (parsed as { nextSlotId?: unknown }).nextSlotId === "string"
          ? (parsed as { nextSlotId: string }).nextSlotId
          : undefined,
      // Anything that is not a well-formed week becomes "no plan" rather than an
      // import failure, matching how the file's targets and habits degrade: a
      // hand-edited plan is not worth refusing someone their six weeks of sets
      // over. A file that never had the key takes this same branch, which is the
      // whole of what a pre-plan backup needs.
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

function persistActiveMeta(meta: { activeSessionId?: string; currentExerciseId?: string }) {
  // Annotated before the put for the same reason as persistSettingsFrom: `meta`
  // is a union table, and an inline literal resolves against the wrong arm.
  const record: ActiveSessionMeta = {
    key: "activeSession",
    activeSessionId: meta.activeSessionId,
    currentExerciseId: meta.currentExerciseId,
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
/**
 * Move the cursor, and start or stop the rest clock in the same breath.
 *
 * Every route to a new cursor goes through here - chosen by hand, advanced onto
 * by finishing a workout, closed up after a delete - because a rest that became
 * current without its clock starting would sit there forever, and a clock left
 * running after the cursor moved off a rest would spend the wrong card.
 */
function cursorTo(
  slots: readonly SplitSlot[],
  id: string | undefined,
): { nextSlotId: string | undefined; restSince: string | undefined } {
  const card = id ? slots.find((sl) => sl.id === id) : undefined;
  return {
    nextSlotId: id,
    restSince: card && kindOf(card) === "rest" ? dayKey(new Date()) : undefined,
  };
}

function persistSettingsFrom(s: State) {
  // Phases and pins are NOT here. They grow with time - a phase per diet change,
  // a pin per planned day - and rewriting one JSON blob on every edit is the
  // wrong shape for that. They have their own tables, written by their own
  // actions, exactly like dailyLogs.
  const settings: SettingsMeta = {
    key: "settings",
    unit: s.unit,
    nextSlotId: s.nextSlotId,
    restSince: s.restSince,
    lastAcceptedPlanAt: s.lastAcceptedPlanAt,
    coachManaged: s.coachManaged,
    planningMode: s.planningMode,
  };
  safeWrite(() => db.meta.put(settings));
}

export const useStore = create<State>((set, get) => ({
  unit: "lbs",
  exercises: [],
  slots: [],
  sessions: [],
  sets: [],
  dailyLogs: [],
  nutritionPhases: [],
  plannedDays: [],
  nextSlotId: undefined,
  restSince: undefined,
  lastAcceptedPlanAt: undefined,
  coachManaged: false,
  planningMode: "week",
  templates: [],
  activeSessionId: undefined,
  currentExerciseId: undefined,
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
        const settings: SettingsMeta = { key: "settings", unit: "lbs" };
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
          nutritionPhases: [],
          plannedDays: [],
          nextSlotId: undefined,
          restSince: undefined,
          lastAcceptedPlanAt: undefined,
          coachManaged: false,
          planningMode: "week",
          activeSessionId: undefined,
          currentExerciseId: undefined,
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
        nutritionPhases: data.nutritionPhases,
        plannedDays: data.plannedDays,
        nextSlotId: data.settings.nextSlotId,
        restSince: data.settings.restSince,
        lastAcceptedPlanAt: data.settings.lastAcceptedPlanAt,
        coachManaged: data.settings.coachManaged ?? false,
        // Absent means a plan written before week mode existed, which is a
        // rotation by construction: cards in a cycle, with no weekdays.
        planningMode: data.settings.planningMode ?? "rotation",
        templates: data.templates,
        // Both default on READ. A settings record written before planning
        // existed has neither key, and no migration is needed to make it mean
        // "no plan" (see the note on `plannedWeek` in db.ts).
        activeSessionId: data.activeSession.activeSessionId,
        currentExerciseId: data.activeSession.currentExerciseId,
        hydrated: true,
      });
    } catch (err) {
      console.error("[store] hydrate failed", err);
      set({ hydrated: true }); // don't leave the UI stuck; falls back to empty in-memory state
    }
  },

  predictedNextSlotName: () => {
    // Reads the CURSOR, not "whichever slot was logged most recently". The old
    // derivation could not see a rest or a repeat, so a split containing either
    // would have suggested the wrong thing the moment one was involved.
    //
    // A rest is a real next card but not a workout NAME, so it is not offered
    // here: this feeds the Start Workout field, and prefilling it with "Rest"
    // would create a slot called Rest the first time somebody hit Start.
    const card = get().nextCard();
    return card && kindOf(card) === "workout" ? card.name : undefined;
  },

  startWorkout: (slotName, on) => {
    const trimmed = slotName.trim();
    let slot = matchSlot(get().slots, trimmed);
    if (!slot) {
      const maxOrder = Math.max(-1, ...get().slots.map((s) => s.rotationOrder));
      slot = { id: uid(), name: trimmed, rotationOrder: maxOrder + 1 };
      set({ slots: [...get().slots, slot] });
      safeWrite(() => db.slots.put(slot!));
    }
    const sessionId = uid();
    // A backdated session starts at midday on its own day rather than at the
    // current time of day: nobody remembers when they started, midday sorts
    // after nothing else on that date, and every day-bucketing surface reads
    // startedAt.
    const startedAt = on ? parseDayKey(on).setHours(12, 0, 0, 0) : Date.now();
    const session: WorkoutSession = { id: sessionId, splitSlotId: slot.id, startedAt };
    set({
      sessions: [...get().sessions, session],
      activeSessionId: sessionId,
      currentExerciseId: undefined,
    });
    safeWrite(() => db.sessions.put(session));
    persistActiveMeta({
      activeSessionId: sessionId,
      currentExerciseId: undefined,
    });
    return sessionId;
  },

  endWorkout: () => {
    const id = get().activeSessionId;
    if (!id) return;
    const sess = get().sessions.find((s) => s.id === id);
    // A backdated workout ended when its last set was logged, not now: an
    // endedAt from the clock would make a Tuesday session eleven hours long.
    const lastSet = [...get().sets]
      .filter((s) => s.sessionId === id)
      .sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const endedAt =
      sess && !isToday(sess.startedAt) ? (lastSet?.loggedAt ?? sess.startedAt) : Date.now();
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
    // Ending a workout CONSUMES its card, which is the only thing that moves the
    // split on for a workout. A cardio bout does not: it has no slot, so there
    // is no card to spend. Computed off the pre-update slots because the walk
    // only reads order and kind, neither of which endWorkout touches.
    // Backfilling last Tuesday must not move where you are in the split: the
    // cursor advances only when the workout just logged is the newest one in
    // the log, which is exactly the "logged it a few hours late" case.
    const newest =
      sess !== undefined &&
      get().sessions.every((s) => s.id === id || s.startedAt <= sess.startedAt);
    const consumedSplit =
      sess?.splitSlotId && newest
        ? advanceSplit(updatedSlots, sess.splitSlotId)?.id
        : get().nextSlotId;
    set({
      sessions: updatedSessions,
      slots: updatedSlots,
      ...cursorTo(updatedSlots, consumedSplit),
      activeSessionId: undefined,
      currentExerciseId: undefined,
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
    });
    // The cursor moved, so the settings record has to move with it. Every other
    // cursor mover persists; this one did not, and the advance was lost on the
    // next launch -- which in a PWA is constantly. The split then sat forever on
    // the card it was pointing at when it was last written.
    persistSettingsFrom(get());
  },

  setCurrentExercise: (exerciseId) => {
    set({ currentExerciseId: exerciseId });
    persistActiveMeta({
      activeSessionId: get().activeSessionId,
      currentExerciseId: exerciseId,
    });
  },

  addExercise: (name, type) => {
    const ex: Exercise = { id: uid(), name: name.trim(), type };
    set({ exercises: [...get().exercises, ex] });
    safeWrite(() => db.exercises.put(ex));
    return ex;
  },

  logSet: ({ exerciseId, weight, reps, rpe, setupNote }) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const session = get().sessions.find((s) => s.id === sessionId);
    const blockGroupId = uid();
    const setsInSession = get().sets.filter((s) => s.sessionId === sessionId);
    const lastLogged = setsInSession.sort((a, b) => b.loggedAt - a.loggedAt)[0];
    // A backdated session is not happening now, so its sets take their own
    // day and carry NO time between sets: the gaps are unknown, and a number
    // read off the clock would be a measurement of how long ago the workout
    // was. One second apart keeps them in order without inventing rest times.
    const backdated = session !== undefined && !isToday(session.startedAt);
    const now = Date.now();
    const loggedAt = backdated ? session.startedAt + setsInSession.length * 1000 : now;
    const tbs =
      lastLogged && !backdated ? Math.round((now - lastLogged.loggedAt) / 1000) : undefined;
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
      loggedAt,
    };
    set({ sets: [...get().sets, newSet], currentExerciseId: exerciseId });
    safeWrite(() => db.sets.put(newSet));
    persistActiveMeta({ activeSessionId: sessionId, currentExerciseId: exerciseId });
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

  updateSession: (sessionId, patch) => {
    set({ sessions: get().sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)) });
    const updated = get().sessions.find((s) => s.id === sessionId);
    if (updated) safeWrite(() => db.sessions.put(updated));
  },

  // --- Nutrition phases ---------------------------------------------------

  addPhase: (phase) => {
    if (get().coachManaged) return undefined;
    if (get().nutritionPhases.some((p) => p.startsOn === phase.startsOn)) return undefined;
    const created: NutritionPhase = { ...phase, id: `np_${uid()}`, name: phase.name.trim() };
    const next = [...get().nutritionPhases, created];
    set({ nutritionPhases: next });
    safeWrite(() => db.nutritionPhases.put(created));
    return created;
  },

  updatePhase: (id, patch) => {
    if (get().coachManaged) return;
    const next = get().nutritionPhases.map((p) => (p.id === id ? { ...p, ...patch } : p));
    set({ nutritionPhases: next });
    const updated = next.find((p) => p.id === id);
    if (updated) safeWrite(() => db.nutritionPhases.put(updated));
  },

  setPhaseStart: (id, startsOn) => {
    if (get().coachManaged) return false;
    // Two phases starting on one day is a contradiction rather than something
    // to resolve with a tiebreak nobody would remember, so it is refused here
    // as well as in the editor - the ribbon can drag a boundary onto a
    // neighbour's date, and a drag has no Save button to refuse at.
    if (get().nutritionPhases.some((p) => p.id !== id && p.startsOn === startsOn)) return false;
    get().updatePhase(id, { startsOn });
    return true;
  },

  deletePhase: (id) => {
    if (get().coachManaged) return;
    set({ nutritionPhases: get().nutritionPhases.filter((p) => p.id !== id) });
    safeWrite(() => db.nutritionPhases.delete(id));
  },

  phaseForDay: (date) => phaseForDate(get().nutritionPhases, date),

  targetsForDay: (date) => targetsForDate(get().nutritionPhases, date),

  isUntrackedDay: (date) =>
    isUntrackedOn(get().nutritionPhases, date, get().dailyLogFor(date)?.isUntracked),

  // --- The workout split --------------------------------------------------

  addSplitCard: ({ name, kind }) => {
    // The one plan guard with a comment, standing for all of them: while a coach
    // manages the plan, the Plan tab is inert, and this is what makes that a
    // guarantee rather than a matter of every control remembering to hide.
    if (get().coachManaged) return undefined;
    const k = kind ?? "workout";
    const orderEnd = get().slots.reduce((m, sl) => Math.max(m, sl.rotationOrder), -1) + 1;
    const card: SplitSlot = {
      id: `sl_${uid()}`,
      // A repeat is a marker rather than a thing with a name, so it carries a
      // fixed one instead of an empty string that every list would have to
      // special-case when rendering.
      name: k === "repeat" ? "Repeat" : (name ?? "").trim() || (k === "rest" ? "Rest" : "Untitled"),
      rotationOrder: orderEnd,
      ...(k === "workout" ? {} : { kind: k }),
    };
    set({ slots: [...get().slots, card] });
    safeWrite(() => db.slots.put(card));
    return card;
  },

  updateSplitCard: (id, patch) => {
    if (get().coachManaged) return;
    const next = get().slots.map((sl) => {
      if (sl.id !== id) return sl;
      const k = patch.kind ?? kindOf(sl);
      const merged: SplitSlot = {
        ...sl,
        ...(patch.name !== undefined ? { name: patch.name.trim() || sl.name } : {}),
        ...(k === "workout" ? { kind: undefined } : { kind: k }),
      };
      // A card that stops being a workout stops carrying lifts: keeping them
      // would resurrect a plan silently if it were ever switched back.
      if (k !== "workout") merged.plannedLifts = undefined;
      if (k === "repeat") merged.name = "Repeat";
      return merged;
    });
    set({ slots: next });
    const updated = next.find((sl) => sl.id === id);
    if (updated) safeWrite(() => db.slots.put(updated));
  },

  deleteSplitCard: (id) => {
    if (get().coachManaged) return;
    const remaining = orderedSplit(get().slots.filter((sl) => sl.id !== id)).map((sl, i) => ({
      ...sl,
      rotationOrder: i,
    }));
    // Move the cursor BEFORE the card goes, so "what comes after this" is still
    // answerable. Deleting the card the split is pointing at would otherwise
    // leave it pointing at nothing.
    const cursorWasHere = get().nextSlotId === id;
    const moved = cursorWasHere ? advanceSplit(get().slots, id)?.id : get().nextSlotId;
    const nextSlotId = moved === id ? firstDayCard(remaining)?.id : moved;
    const dropped = get().slots.filter((sl) => sl.id === id);
    const named = rememberSlotNames(get().sessions, dropped);
    set({
      slots: remaining,
      sessions: withSessions(get().sessions, named),
      ...cursorTo(remaining, nextSlotId),
    });
    safeWrite(() =>
      db.transaction("rw", [db.slots, db.sessions], async () => {
        await db.slots.delete(id);
        await db.slots.bulkPut(remaining);
        if (named.length > 0) await db.sessions.bulkPut(named);
      }),
    );
    persistSettingsFrom(get());
  },

  moveSplitCard: (id, toIndex) => {
    if (get().coachManaged) return;
    const ordered = orderedSplit(get().slots);
    const from = ordered.findIndex((sl) => sl.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(ordered.length - 1, toIndex));
    if (from === to) return;
    const [card] = ordered.splice(from, 1);
    ordered.splice(to, 0, card);
    const renumbered = ordered.map((sl, i) => ({ ...sl, rotationOrder: i }));
    set({ slots: renumbered });
    safeWrite(() => db.slots.bulkPut(renumbered));
  },

  setNextCard: (id) => {
    const card = get().slots.find((sl) => sl.id === id);
    // A repeat is not a day, so it cannot be what you do next.
    if (!card || kindOf(card) === "repeat") return;
    set(cursorTo(get().slots, id));
    persistSettingsFrom(get());
  },

  takeRestDay: (id) => {
    const card = get().slots.find((sl) => sl.id === id);
    if (!card || kindOf(card) !== "rest") return;
    set(cursorTo(get().slots, advanceSplit(get().slots, id)?.id));
    persistSettingsFrom(get());
  },

  settleRestDay: () => {
    const card = get().nextCard();
    const today = dayKey(new Date());

    if (!card || kindOf(card) !== "rest") {
      // The cursor moved off the rest by some other route. Drop the clock
      // rather than leaving a date behind that nothing is measuring.
      if (get().restSince !== undefined) {
        set({ restSince: undefined });
        persistSettingsFrom(get());
      }
      return;
    }

    if (get().restSince === undefined) {
      // A rest is current but nothing recorded when it became current: an
      // imported backup, or a split edited into this shape. Start its clock
      // today rather than spending it instantly on a day off nobody took.
      set({ restSince: today });
      persistSettingsFrom(get());
      return;
    }

    if (today <= get().restSince!) return;
    set(cursorTo(get().slots, advanceSplit(get().slots, card.id)?.id));
    persistSettingsFrom(get());
  },

  nextCard: () => {
    const { slots, nextSlotId, planningMode } = get();
    // In week mode "next" is simply what today holds: no cursor, no
    // consumption, and nothing to drift out of step with the calendar.
    if (planningMode === "week") return cardForWeekday(slots, new Date().getDay());
    const pointed = nextSlotId ? slots.find((sl) => sl.id === nextSlotId) : undefined;
    // A stale cursor - the card was deleted, or an import replaced the split -
    // falls back to the top rather than leaving the screen with no answer.
    if (pointed && kindOf(pointed) !== "repeat") return pointed;
    return firstDayCard(slots);
  },

  // --- Training plan ------------------------------------------------------

  setSlotLifts: (slotId, lifts) => {
    if (get().coachManaged) return;
    // Deduped and pruned to exercises that still exist, so deleting an exercise
    // cannot leave a card preloading a lift the picker has never heard of.
    const live = new Set(get().exercises.map((e) => e.id));
    const seen = new Set<string>();
    const cleaned = lifts.filter((lift) => {
      if (!live.has(lift.exerciseId) || seen.has(lift.exerciseId)) return false;
      seen.add(lift.exerciseId);
      return true;
    });
    const next = get().slots.map((sl) =>
      sl.id === slotId ? { ...sl, plannedLifts: cleaned } : sl,
    );
    set({ slots: next });
    const updated = next.find((sl) => sl.id === slotId);
    if (updated) safeWrite(() => db.slots.put(updated));
  },

  acceptCoachPlan: (plan) => {
    const state = get();
    const resolved = resolvePlan(
      plan,
      {
        slots: state.slots,
        exercises: state.exercises,
        nutritionPhases: state.nutritionPhases,
      },
      uid,
    );

    const exercises = [...state.exercises, ...resolved.createdExercises];
    const keptSlotIds = new Set(resolved.slots.map((sl) => sl.id));
    const droppedSlots = state.slots.filter((sl) => !keptSlotIds.has(sl.id));
    // A dropped card goes quietly, but its history keeps its name.
    const named = rememberSlotNames(state.sessions, droppedSlots);
    set({
      exercises,
      slots: resolved.slots,
      sessions: withSessions(state.sessions, named),
      // The coach chooses how the split is arranged, the same as they choose
      // what is in it.
      planningMode: plan.mode,
      nutritionPhases: resolved.phases,
      plannedDays: resolved.pins,
      lastAcceptedPlanAt: plan.issuedAt,
      coachManaged: true,
      // The split cursor may point at a card this plan dropped. Clearing it
      // sends the rotation back to the top rather than leaving it stranded on
      // a card that no longer exists.
      nextSlotId: resolved.slots.some((sl) => sl.id === state.nextSlotId)
        ? state.nextSlotId
        : undefined,
    });

    // One transaction, so the tables cannot disagree about which plan is in
    // force. Deletes come from the difference against what was there before:
    // Dexie has no "replace this table" primitive.
    const droppedSlotIds = droppedSlots.map((sl) => sl.id);
    const keptPhaseIds = new Set(resolved.phases.map((ph) => ph.id));
    const droppedPhaseIds = state.nutritionPhases
      .map((ph) => ph.id)
      .filter((id) => !keptPhaseIds.has(id));
    const keptPinDates = new Set(resolved.pins.map((pin) => pin.date));
    const droppedPinDates = state.plannedDays
      .map((pin) => pin.date)
      .filter((date) => !keptPinDates.has(date));

    safeWrite(() =>
      db.transaction(
        "rw",
        [db.exercises, db.slots, db.sessions, db.nutritionPhases, db.plannedDays, db.meta],
        async () => {
          if (named.length > 0) await db.sessions.bulkPut(named);
          if (resolved.createdExercises.length > 0) {
            await db.exercises.bulkPut(resolved.createdExercises);
          }
          await db.slots.bulkDelete(droppedSlotIds);
          await db.slots.bulkPut(resolved.slots);
          await db.nutritionPhases.bulkDelete(droppedPhaseIds);
          await db.nutritionPhases.bulkPut(resolved.phases);
          await db.plannedDays.bulkDelete(droppedPinDates);
          await db.plannedDays.bulkPut(resolved.pins);
        },
      ),
    );
    persistSettingsFrom(get());
  },

  setPlanningMode: (mode) => {
    if (get().coachManaged || get().planningMode === mode) return;
    // The cards are rearranged, never rewritten: a week becomes a cycle in the
    // order the days ran, and a cycle becomes a week from Monday. Every session
    // logged against a card stays attached to it, because the card keeps its id.
    const slots = convertSplit(get().slots, mode);
    const nextSlotId = mode === "rotation" ? firstDayCard(slots)?.id : undefined;
    set({ planningMode: mode, slots, ...cursorTo(slots, nextSlotId) });
    safeWrite(() => db.slots.bulkPut(slots));
    persistSettingsFrom(get());
  },

  saveTemplateFrom: (slotId, name) => {
    const slot = get().slots.find((sl) => sl.id === slotId);
    if (!slot) return undefined;
    const byId = new Map(get().exercises.map((e) => [e.id, e.name]));
    // Names, not ids: a template is applied to whoever is on screen, and in
    // coach mode that is a client whose exercise ids are their own.
    const lifts = (slot.plannedLifts ?? [])
      .map(({ exerciseId, sets, reps, load }) => {
        const liftName = byId.get(exerciseId);
        if (liftName === undefined) return undefined;
        return {
          name: liftName,
          ...(sets === undefined ? {} : { sets }),
          ...(reps === undefined ? {} : { reps }),
          ...(load === undefined ? {} : { load }),
        };
      })
      .filter((lift): lift is PlanLift => lift !== undefined);

    const template: WorkoutTemplate = {
      id: `tpl_${uid()}`,
      name: (name ?? slot.name).trim() || slot.name,
      lifts,
    };
    set({ templates: [...get().templates, template] });
    safeWrite(() => saveTemplateRecord(template));
    return template;
  },

  deleteTemplate: (id) => {
    set({ templates: get().templates.filter((t) => t.id !== id) });
    safeWrite(() => deleteTemplateRecord(id));
  },

  applyTemplate: (templateId, slotId) => {
    if (get().coachManaged) return;
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) return;

    // One pass over the names, creating what is missing as an accessory --
    // the conservative label, matching what an arriving plan does.
    const created: Exercise[] = [];
    const byName = new Map(get().exercises.map((e) => [e.name.trim().toLowerCase(), e]));
    const lifts: PlannedLift[] = template.lifts.map((lift) => {
      const key = lift.name.trim().toLowerCase();
      let exercise = byName.get(key);
      if (!exercise) {
        exercise = { id: `ex_${uid()}`, name: lift.name.trim(), type: "accessory" };
        byName.set(key, exercise);
        created.push(exercise);
      }
      return {
        exerciseId: exercise.id,
        ...(lift.sets === undefined ? {} : { sets: lift.sets }),
        ...(lift.reps === undefined ? {} : { reps: lift.reps }),
        ...(lift.load === undefined ? {} : { load: lift.load }),
      };
    });

    const exercises = created.length > 0 ? [...get().exercises, ...created] : get().exercises;
    const slots = get().slots.map((sl) => (sl.id === slotId ? { ...sl, plannedLifts: lifts } : sl));
    set({ exercises, slots });
    const updated = slots.find((sl) => sl.id === slotId);
    safeWrite(async () => {
      if (created.length > 0) await db.exercises.bulkPut(created);
      if (updated) await db.slots.put(updated);
    });
  },

  setCardWeekday: (slotId, weekday) => {
    if (get().coachManaged) return;
    // One card per day: assigning a day takes it off whatever card held it, or
    // two cards would claim the same morning and nothing could answer "today".
    const slots = get().slots.map((sl) => {
      if (sl.id === slotId) return { ...sl, weekday };
      return weekday !== undefined && sl.weekday === weekday ? { ...sl, weekday: undefined } : sl;
    });
    set({ slots });
    safeWrite(() => db.slots.bulkPut(slots));
  },

  unlinkCoach: () => {
    set({ coachManaged: false });
    persistSettingsFrom(get());
  },

  pinDay: (date, splitSlotId) => {
    if (get().coachManaged) return;
    if (!get().slots.some((sl) => sl.id === splitSlotId)) return;
    const pin: PlannedDay = { date, splitSlotId };
    set({ plannedDays: [...get().plannedDays.filter((d) => d.date !== date), pin] });
    safeWrite(() => db.plannedDays.put(pin));
  },

  unpinDay: (date) => {
    if (get().coachManaged) return;
    set({ plannedDays: get().plannedDays.filter((d) => d.date !== date) });
    safeWrite(() => db.plannedDays.delete(date));
  },

  pinnedSlotFor: (date) => {
    const id = pinnedSlotIdFor(get().plannedDays, date);
    return id ? get().slots.find((sl) => sl.id === id) : undefined;
  },

  reorderSlots: (fromId, toId) => {
    if (get().coachManaged) return;
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
      nutritionPhases: data.nutritionPhases,
      plannedDays: data.plannedDays,
      nextSlotId: data.nextSlotId,
      // Not in the backup: a clock reading, not a plan. settleRestDay starts a
      // restored rest's clock from the day of the restore.
      restSince: undefined,
      unit: data.unit,
      // Restored from the file, not cleared. `replaceAllData` has just written
      // both of these into the settings record, so anything else here would
      // leave the store disagreeing with the DB until the next reload quietly
      // corrected it. A file with no plan carries `undefined`, which lands the
      // reader on "never planned" - the same state the file's author was in.
      activeSessionId: undefined,
      currentExerciseId: undefined,
      // Neither is in a backup, and `replaceAllData` has just written a settings
      // record without them. Cleared here too, or the store would disagree with
      // disk until a reload. A coach plan still in the sheet is simply offered
      // again, and accepting it restores both.
      lastAcceptedPlanAt: undefined,
      coachManaged: false,
      templates: data.templates,
    });
  },

  clearAllData: async () => {
    // Reuse the atomic replace: wipe every table, then write back only the
    // exercise preset library with empty history and default settings. That is
    // exactly the state a first run lands in, so "clear data" and a fresh
    // install are the same thing rather than two subtly different starts.
    await replaceAllData({
      version: BACKUP_VERSION,
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      nutritionPhases: [],
      plannedDays: [],
      templates: [],
      nextSlotId: undefined,
      unit: "lbs",
    });
    set({
      exercises: seedExercises,
      slots: [],
      sessions: [],
      sets: [],
      dailyLogs: [],
      nutritionPhases: [],
      plannedDays: [],
      nextSlotId: undefined,
      restSince: undefined,
      unit: "lbs",
      activeSessionId: undefined,
      currentExerciseId: undefined,
      lastAcceptedPlanAt: undefined,
      coachManaged: false,
      templates: [],
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
