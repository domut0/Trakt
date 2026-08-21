import { setsForExercise, volumeFor } from "./exercise-history";
import { headlineRecord, sessionRecords, type PRKind } from "./pr";
import type { Exercise, WorkoutSession, WorkoutSet } from "./store";

/**
 * The facts of a finished workout, assembled once when the user ends it.
 *
 * Pure: no store, no Dexie, no DOM, no clock. The caller hands over the state it
 * already has plus the instant the session ended, which is what makes every rule
 * below testable with plain arrays.
 *
 * Two contracts are discharged here rather than left to the screen:
 *
 * 1. AN EMPTY SESSION HAS NO SUMMARY. Ending a workout with nothing logged is a
 *    cancel, not an achievement, so this returns `null` and the caller shows
 *    nothing at all.
 * 2. HISTORY GOES THROUGH `setsForExercise`. It takes the sessions list
 *    precisely so the cardio guard cannot be skipped, and a treadmill entry that
 *    somehow carries sets can therefore never enter a record comparison. See the
 *    contract note on `bestSetFor` in exercise-history.ts.
 *
 * Nothing here throws on bad input: corrupt history costs the user a missed
 * record, never the screen that ends their workout.
 */

export interface SummaryRecord {
  kind: PRKind;
  exerciseId: string;
  exerciseName: string;
  /** The value achieved: pounds/kilos, estimated 1RM, or rep count. */
  value: number;
  /** The best value before this session. Always something real to beat. */
  previous: number;
  /** The load a rep record was set at. Undefined on the other two axes. */
  atWeight?: number;
}

export interface WorkoutSummaryData {
  sessionId: string;
  slotName: string;
  durationMinutes: number;
  setCount: number;
  exerciseCount: number;
  /**
   * Total weight moved, rounded. `null` when the arithmetic came out unusable
   * (an imported set with a NaN weight), because omitting the row is honest and
   * printing 0 is not.
   */
  volume: number | null;
  unit: "lbs" | "kg";
  /**
   * At most one record per exercise, most significant first.
   *
   * `sessionRecords` returns every axis a lifter beat, which for a single top
   * set is very often weight AND estimated 1RM at once. Reporting both is the
   * "three badges on one set" noise pr.ts exists to avoid, so each exercise
   * keeps only its highest-ranked record, and `headlineRecord` decides which of
   * those leads.
   */
  records: SummaryRecord[];
}

export interface WorkoutSummaryInput {
  session: WorkoutSession | undefined;
  /** The split slot's name, for the header. */
  slotName: string;
  /** The whole sets collection. Filtered here, both ways. */
  sets: WorkoutSet[];
  sessions: WorkoutSession[];
  exercises: Exercise[];
  unit: "lbs" | "kg";
  /** When the session ended, i.e. `Date.now()` at the moment End was pressed. */
  endedAt: number;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Builds the summary, or `null` when there is nothing honest to show: no
 * session, a cardio session (which holds no sets and no records), or a strength
 * session with nothing logged.
 */
export function buildWorkoutSummary(input: WorkoutSummaryInput): WorkoutSummaryData | null {
  const { session, slotName, sets, sessions, exercises, unit, endedAt } = input;

  if (!session || typeof session.id !== "string" || session.id.length === 0) return null;
  // Compared inline rather than through `isCardioSession` to keep store.ts a
  // type-only import here, the same rule pr.ts and exercise-history.ts follow.
  // An absent `kind` still means strength.
  if (session.kind === "cardio") return null;
  if (!Array.isArray(sets) || !Array.isArray(sessions) || !Array.isArray(exercises)) return null;

  const sessionSets = sets
    .filter((s) => s != null && s.sessionId === session.id)
    .sort((a, b) => a.loggedAt - b.loggedAt);
  if (sessionSets.length === 0) return null;

  const startedAt = safeNumber(session.startedAt);
  const finishedAt = safeNumber(endedAt);
  const durationMinutes =
    startedAt != null && finishedAt != null
      ? Math.max(0, Math.round((finishedAt - startedAt) / 60_000))
      : 0;

  const exerciseIds: string[] = [];
  for (const s of sessionSets) {
    if (!exerciseIds.includes(s.exerciseId)) exerciseIds.push(s.exerciseId);
  }

  const rawVolume = volumeFor(sessionSets);
  const volume = Number.isFinite(rawVolume) && rawVolume > 0 ? Math.round(rawVolume) : null;

  return {
    sessionId: session.id,
    slotName,
    durationMinutes,
    setCount: sessionSets.length,
    exerciseCount: exerciseIds.length,
    volume,
    unit,
    records: buildRecords(session, sessionSets, exerciseIds, sets, sessions, exercises),
  };
}

function buildRecords(
  session: WorkoutSession,
  sessionSets: WorkoutSet[],
  exerciseIds: string[],
  allSets: WorkoutSet[],
  sessions: WorkoutSession[],
  exercises: Exercise[],
): SummaryRecord[] {
  // Only the exercises trained today can produce a record today, and each one's
  // history arrives through the guard that filters cardio sessions out.
  // `sessionRecords` strips this session's own sets from the history side, so
  // handing it a list that still contains them is safe and deliberate.
  const history = exerciseIds.flatMap((id) => setsForExercise(allSets, id, sessions));
  const found = sessionRecords(session, sessionSets, history);
  if (found.length === 0) return [];

  const bestPerExercise = found.filter((record, index) => {
    return found.findIndex((other) => other.exerciseId === record.exerciseId) === index;
  });

  // Ranked all the way down, not just at the top. `headlineRecord` is applied
  // repeatedly to what is left rather than the ranking being re-declared here,
  // so pr.ts stays the single source of truth for what "most significant"
  // means, and a change to KIND_ORDER there cannot leave this file behind.
  // It returns the entry itself, so identity recovers the SessionRecord (with
  // its exercise and set) rather than the narrower type, and it keeps the
  // earlier entry on a tie, which is what preserves the session's own order
  // between two records of equal rank. At most one entry per exercise reaches
  // this loop, so the quadratic shape is over a handful of items.
  const remaining = [...bestPerExercise];
  const ordered: typeof bestPerExercise = [];
  while (remaining.length > 0) {
    const head = headlineRecord(remaining);
    const index = head ? remaining.findIndex((record) => record === head) : -1;
    ordered.push(...remaining.splice(index === -1 ? 0 : index, 1));
  }

  const nameById = new Map(exercises.map((e) => [e.id, e.name]));
  const setById = new Map(sessionSets.map((s) => [s.id, s]));

  return ordered.flatMap((record) => {
    const exerciseName = nameById.get(record.exerciseId);
    // A record whose exercise cannot be named says nothing to the user; drop it
    // rather than print "unknown".
    if (!exerciseName) return [];
    const atWeight = record.kind === "reps" ? setById.get(record.setId)?.weight : undefined;
    return [
      {
        kind: record.kind,
        exerciseId: record.exerciseId,
        exerciseName,
        value: record.value,
        previous: record.previous,
        ...(atWeight != null ? { atWeight } : {}),
      },
    ];
  });
}

/** One decimal at most, grouped: 12450 -> "12,450", 262.5 -> "262.5". */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/**
 * A session length in the same unit the rest of the app records one in
 * (see `toCsv`, which exports minutes). Hours only appear once there are some.
 */
export function formatDuration(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** What the record is, in the lifter's terms. */
export function recordTitle(record: SummaryRecord, unit: string): string {
  if (record.kind === "weight") return `Heaviest ${record.exerciseName}`;
  if (record.kind === "e1rm") return `Best estimated 1RM, ${record.exerciseName}`;
  if (record.atWeight != null) {
    return `Most reps at ${formatNumber(record.atWeight)} ${unit}, ${record.exerciseName}`;
  }
  return `Most reps, ${record.exerciseName}`;
}

/** The number it beat. Stated flatly: the size of the step is the user's to judge. */
export function recordDetail(record: SummaryRecord, unit: string): string {
  if (record.kind === "reps") {
    return `Up from ${formatNumber(record.previous)} ${record.previous === 1 ? "rep" : "reps"}`;
  }
  return `Up from ${formatNumber(record.previous)} ${unit}`;
}

/** The record's value, split so the unit can be set smaller than the number. */
export function recordValue(
  record: SummaryRecord,
  unit: string,
): { value: string; suffix: string } {
  if (record.kind === "reps") {
    return { value: formatNumber(record.value), suffix: record.value === 1 ? "rep" : "reps" };
  }
  return { value: formatNumber(record.value), suffix: unit };
}
