import type { PlannedLift, WorkoutSet } from "./store";

/**
 * The exercise screen's rows, and the numbers they suggest.
 *
 * A row is a POSITION in an exercise, not a record: row three is the third set
 * of this lift today whether or not it has happened yet. A logged set is
 * attached to a row by ORDER alone - the nth set logged for the exercise in this
 * session fills the nth row - because a set carries no memory of which
 * prescribed set it was meant to be, and giving it one drifts the moment
 * somebody adds or skips one.
 */

/**
 * What a card prescribed, as one line: "3 × 8-12 · RPE 8".
 *
 * Empty for a lift nobody put numbers against, which the exercise screen reads
 * as "leave the Plan line out" rather than printing a heading over nothing.
 */
export function prescriptionOf(lift: PlannedLift | undefined): string {
  if (!lift) return "";
  const parts: string[] = [];
  if (lift.sets !== undefined && lift.reps) parts.push(`${lift.sets} × ${lift.reps}`);
  else if (lift.sets !== undefined) parts.push(`${lift.sets} sets`);
  else if (lift.reps) parts.push(lift.reps);
  if (lift.load) parts.push(lift.load);
  return parts.join(" · ");
}

/**
 * The numbers hiding in a free-text load, so a prescription can ghost them.
 *
 * `load` is a string on purpose (see PlannedLift): programmes are written as
 * "100kg", "RPE 8" and "70%" as often as they are written as a number. Only the
 * first two name something that can go in a field. A percentage is a share of a
 * one-rep max this app does not store, so it is left on the Plan line to be
 * read rather than guessed at.
 */
export function parseLoad(load: string | undefined): { weight?: number; rpe?: number } {
  if (!load) return {};
  const rpeMatch = load.match(/rpe\s*(\d+(?:\.\d+)?)/i);
  // Whatever the RPE already claimed cannot also be the weight, so "RPE 8" does
  // not ghost 8 kg into the bar.
  const rest = rpeMatch ? load.replace(rpeMatch[0], " ") : load;
  const weightMatch = rest.match(/(\d+(?:\.\d+)?)\s*(%?)/);
  return {
    weight: weightMatch && weightMatch[2] !== "%" ? Number(weightMatch[1]) : undefined,
    rpe: rpeMatch ? Number(rpeMatch[1]) : undefined,
  };
}

/**
 * The suggestion an unlogged row shows, and pre-fills its editor with.
 *
 * Grey on the row, real values in the editor: a ghost is an offer, so one tap
 * and Save has to be enough to log the set as prescribed.
 */
export interface GhostValues {
  weight?: number;
  /** The reps as prescribed, so a range stays a range on the row. */
  repsLabel?: string;
  /** The single number that range puts in the editor: its low end. */
  reps?: number;
  rpe?: number;
}

export interface SetRow {
  /** 1-based, and what the row is called: "Set 3". */
  index: number;
  /** The set this row records, once one has been logged into it. */
  set?: WorkoutSet;
  /** Empty for a logged row, which shows its own real numbers instead. */
  ghost: GhostValues;
}

/** The first whole number in a prescribed rep range: "8-12" opens at 8. */
function firstInteger(text: string): number | undefined {
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

/**
 * One row per prescribed set, plus one per set logged beyond the prescription,
 * and never fewer than one - an exercise with nothing prescribed and nothing
 * logged still needs something to tap.
 *
 * Ghosts are decided PER FIELD, in three steps: the prescription wins, then
 * what you have already done to this lift TODAY, then last time at this row.
 *
 * The middle step is what the app has always done and what a lifter expects:
 * go up to 105 on set one and set two offers 105, not last week's 100. The
 * prescription still overrides it, because that is an instruction rather than
 * a guess - and last week still fills any field neither of the other two
 * named, which is what makes a first set land on real numbers at all.
 */
export function buildSetRows({
  lift,
  logged,
  lastSession,
  minRows = 0,
}: {
  /** The prescription, when this exercise came off a plan. */
  lift?: PlannedLift;
  /** This session's sets for this exercise, oldest first. */
  logged: readonly WorkoutSet[];
  /** The previous session's sets for it, oldest first. Never this session's. */
  lastSession: readonly WorkoutSet[];
  /** How far "+ Add set" has pushed the row count. */
  minRows?: number;
}): SetRow[] {
  const prescribed = parseLoad(lift?.load);
  // The most recent set of this lift today, which is the shape of the session
  // as it is actually going.
  const soFar = logged.length > 0 ? logged[logged.length - 1] : undefined;
  const repsLabel = lift?.reps?.trim() || undefined;
  const prescribedReps = repsLabel ? firstInteger(repsLabel) : undefined;
  const count = Math.max(lift?.sets ?? 0, logged.length, minRows, 1);

  const rows: SetRow[] = [];
  for (let i = 0; i < count; i++) {
    const set = logged[i];
    // Last time is read at THIS row's index, which is what makes a ghost a
    // per-position suggestion rather than one number repeated down the list. A
    // row past the end of last week's list takes its final set, because adding
    // a fourth set to last week's three has nothing else to go on.
    const back = lastSession.length ? lastSession[Math.min(i, lastSession.length - 1)] : undefined;
    rows.push({
      index: i + 1,
      set,
      ghost: set
        ? {}
        : {
            weight: prescribed.weight ?? soFar?.weight ?? back?.weight,
            repsLabel:
              repsLabel ?? (soFar ? String(soFar.reps) : back ? String(back.reps) : undefined),
            reps: prescribedReps ?? soFar?.reps ?? back?.reps,
            rpe: prescribed.rpe ?? soFar?.rpe ?? back?.rpe,
          },
    });
  }
  return rows;
}

/** "100×9, 100×8, 95×8" - what the last session came to, on one line. */
export function lastTimeLine(sets: readonly WorkoutSet[]): string {
  return sets.map((s) => `${s.weight}×${s.reps}`).join(", ");
}

/**
 * Whether an exercise still has a row nobody has logged into, which is what
 * makes it a candidate for "what comes next".
 *
 * An unprescribed lift counts as one row, matching the floor in `buildSetRows`:
 * an exercise on the list with nothing logged against it is unfinished however
 * it got there.
 */
export function hasUnloggedSets(lift: PlannedLift | undefined, loggedCount: number): boolean {
  return loggedCount < Math.max(lift?.sets ?? 0, 1);
}
