import { estimate1RM, RELIABLE_REP_LIMIT } from "./onerm";
import type { WorkoutSession, WorkoutSet } from "./store";

/**
 * Personal-record detection. Pure: no store, no Dexie, no DOM, no clock. The
 * caller supplies the history and (where it matters) the ordering timestamps
 * already on the sets.
 *
 * The store is imported for TYPES ONLY, the same rule exercise-history.ts
 * follows, so importing this module can never drag zustand or Dexie into a
 * runtime cycle. `isCardioSession` is deliberately re-implemented here as a
 * local one-liner rather than imported as a value, for exactly that reason.
 *
 * Everything here degrades to "no record" on bad input. History round-trips
 * through user-editable backup JSON and `isWorkoutSet` in store.ts only checks
 * `typeof weight === "number"`, so NaN, Infinity, negative loads and zero-rep
 * sets all survive an import. A corrupt file must cost the user a missed
 * celebration, never a crash on the screen that ends their workout.
 */

/**
 * The three axes a set can set a record on.
 *
 * - `weight`: heaviest load ever moved for this exercise, at any rep count.
 * - `e1rm`: best estimated 1RM ever (see onerm.ts for the formulas).
 * - `reps`: most reps ever performed at this weight OR ABOVE. The "or above"
 *   half is what stops a lifter who has only ever done 315x3 from being told
 *   that today's 135x10 is a rep record: the comparison pool at 135 includes
 *   every heavier set too.
 */
export type PRKind = "weight" | "e1rm" | "reps";

export interface PersonalRecord {
  kind: PRKind;
  /** The value achieved: pounds/kilos, estimated 1RM, or rep count. */
  value: number;
  /**
   * The best previous value on this axis, i.e. the number this set beat.
   *
   * Always defined, and that is a consequence of a design decision rather than
   * an accident: a set with no history to beat is not reported as a record at
   * all (see `personalRecordsFor`), so there is no "record with nothing behind
   * it" case for the UI to special-case.
   */
  previous: number;
}

export interface SessionRecord extends PersonalRecord {
  exerciseId: string;
  /** The set that achieved it, so a summary can quote the actual weight/reps. */
  setId: string;
}

/**
 * Tolerance for every numeric comparison in this file.
 *
 * Weights are user-typed decimals (62.5 kg) that round-trip through JSON, and
 * estimated 1RMs come out of two formulas that divide and multiply. Comparing
 * either with a bare `>` lets binary noise at the fifteenth decimal place
 * announce a personal record for repeating last week's set exactly. Reps go
 * through the same helper for uniformity; they are integers in practice, so the
 * epsilon is simply inert there.
 */
export const PR_EPSILON = 1e-6;

/**
 * A set must reach this fraction of the exercise's best-ever effort before it
 * can be credited with a REP record.
 *
 * This is a backstop for a warm-up flag the data model does not have.
 * `WorkoutSet` carries `isDropsetOrPartial` and nothing else, so a 45x10 warm-up
 * is structurally indistinguishable from a 45x10 working set. That matters only
 * on the rep axis: to win the weight or e1RM axis a set has to beat the whole
 * history outright, which a warm-up by definition cannot do, but "most reps at
 * 45 lbs or above" is winnable by a warm-up whenever the lifter trains
 * exclusively in low rep ranges. Announcing "rep PR" for the empty bar is
 * precisely the hollow praise that makes an app feel fake.
 *
 * A ratio cannot do this job alone, and it is worth being honest about why. The
 * effort score is an estimated 1RM, so it reads a warm-up and a burnout set the
 * same way whenever they happen to land on the same estimate: 135x10 against a
 * 315 best scores 0.53, while a genuine 135x25 rep-out against that same best
 * scores 0.96, but 135x10 against a 225 best scores 0.74. No single threshold
 * separates all three. 0.6 sits above the warm-up band for a lifter whose top
 * set is far heavier and below every back-off and rep-out set tested, which is
 * the most a context-free comparison can achieve.
 *
 * The exact rule lives in `sessionRecords`, which can see what came next in the
 * workout (see `supersededInSession`). The real fix is an `isWarmup` flag on
 * `WorkoutSet`, which is out of scope for this module.
 */
export const WARMUP_EFFORT_FLOOR = 0.6;

/**
 * Report order, most impressive first, and the tiebreak `headlineRecord` uses.
 *
 * A single set very often lands on several axes at once: 315x5 against a
 * previous best of 315x3 is both a rep record and almost certainly an e1RM
 * record. All of them are returned, because throwing the extras away here would
 * make them unrecoverable, but they come back RANKED so a caller that wants one
 * badge can take the first and be right. Three badges on one set is noise.
 *
 * Weight leads because it is the number a lifter says out loud ("I hit 315");
 * e1RM follows because it is a real but derived estimate; reps last because it
 * is the most conditional of the three, being scoped to a weight band rather
 * than to the whole exercise.
 */
const KIND_ORDER: readonly PRKind[] = ["weight", "e1rm", "reps"];

function kindRank(kind: PRKind): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * True for a set that may take part in record comparisons, on either side.
 *
 * Two separate rejections live here on purpose:
 *
 * 1. Structural nonsense (missing ids, NaN/Infinity/negative/zero weights or
 *    reps). Imported data is validated loosely enough by `parseBackup` that all
 *    of these reach us intact.
 * 2. `isDropsetOrPartial`. A dropset's rep count spans several loads and a
 *    partial's reps are not full-range reps, so the number is not comparable to
 *    a straight set's. Such sets are excluded from CANDIDACY and from HISTORY
 *    alike. Excluding them from only one side would be worse in both
 *    directions: kept as history, a 315x20 partial would block honest rep
 *    records at 315 forever; kept as a candidate, it would win them off reps the
 *    lifter never actually performed.
 */
function isComparableSet(value: unknown): value is WorkoutSet {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.exerciseId !== "string" || value.exerciseId.length === 0) return false;
  if (typeof value.sessionId !== "string") return false;
  if (!isPositiveFinite(value.weight)) return false;
  if (!isPositiveFinite(value.reps)) return false;
  if (value.isDropsetOrPartial === true) return false;
  return true;
}

/** Strictly better, with float noise discounted. Equalling a best is not beating it. */
function exceeds(candidate: number, best: number): boolean {
  return candidate - best > PR_EPSILON;
}

/** Max of a mapped list, without spreading a whole training history onto the stack. */
function maxOf(sets: readonly WorkoutSet[], value: (set: WorkoutSet) => number): number {
  let best = 0;
  for (const set of sets) {
    const current = value(set);
    if (current > best) best = current;
  }
  return best;
}

/**
 * Estimated 1RM as an effort proxy, used only for the warm-up floor.
 *
 * Deliberately uncapped: past RELIABLE_REP_LIMIT the estimate is not accurate
 * enough to CLAIM a record with, but it is still a perfectly good answer to
 * "was this set anywhere near a real working set?", which is all the floor asks.
 * The same number is therefore trusted for one job and not the other.
 */
function effortScore(set: WorkoutSet): number {
  const value = estimate1RM(set.weight, set.reps).average;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Estimated 1RM when it is trustworthy enough to be a record, else 0.
 *
 * onerm.ts already documents that both formulas drift badly past
 * RELIABLE_REP_LIMIT reps and that the UI stops vouching for the number there.
 * A metric the app itself hedges on is not one to hand the user a trophy for, so
 * high-rep sets are dropped from the e1RM axis on BOTH sides: they cannot claim
 * an e1RM record, and they cannot inflate the bar that a later honest single has
 * to clear. A 20-rep set stays fully eligible for weight and rep records.
 *
 * 0 doubles as "not eligible", which is safe because a real estimate is always
 * positive and every use site checks for a positive value before comparing.
 */
function recordE1rm(set: WorkoutSet): number {
  if (set.reps > RELIABLE_REP_LIMIT) return 0;
  return effortScore(set);
}

/** Prior sets at this load or heavier: the comparison pool for a rep record. */
function atOrAboveWeight(sets: readonly WorkoutSet[], weight: number): WorkoutSet[] {
  return sets.filter((set) => set.weight + PR_EPSILON >= weight);
}

/**
 * Every personal record a single set sets against that exercise's prior history.
 * Returns an empty array, never throws, when there is nothing to celebrate.
 *
 * `history` is the sets performed BEFORE this one. It is filtered defensively:
 * entries for other exercises are dropped, as is any entry sharing the
 * candidate's id, so a caller may hand over an unfiltered slice (including one
 * that still contains this very set) and still get a correct answer.
 *
 * What this CANNOT check for itself is cardio. It sees sets, not sessions, so it
 * has no way to know a set belongs to a treadmill entry. That is the same
 * contract `bestSetFor` in exercise-history.ts documents, and it is discharged
 * the same way: feed it the output of `setsForExercise`, which takes the
 * sessions list precisely so the cardio guard cannot be skipped.
 *
 * Warm-ups are caught here only by WARMUP_EFFORT_FLOOR, which is a backstop
 * rather than a rule: with one set and a flat history there is no way to know
 * that a lifter is working up to something heavier. `sessionRecords` can see the
 * rest of the workout and applies the exact test, so it is the better source for
 * anything that celebrates after the fact.
 *
 * THE FIRST EVER SET OF AN EXERCISE IS NOT A RECORD. With no usable history
 * every number is technically an all-time best, and saying so is hollow: the
 * user knows they have never benched before. An exercise starts producing
 * records on its second outing, once there is something real to beat. The same
 * rule is why `PersonalRecord.previous` can be a plain `number`.
 */
export function personalRecordsFor(
  set: WorkoutSet,
  history: readonly WorkoutSet[],
): PersonalRecord[] {
  if (!isComparableSet(set)) return [];
  if (!Array.isArray(history)) return [];

  const pool = history.filter(
    (entry): entry is WorkoutSet =>
      isComparableSet(entry) && entry.exerciseId === set.exerciseId && entry.id !== set.id,
  );
  if (pool.length === 0) return [];

  const records: PersonalRecord[] = [];

  const heaviest = maxOf(pool, (entry) => entry.weight);
  if (exceeds(set.weight, heaviest)) {
    records.push({ kind: "weight", value: set.weight, previous: heaviest });
  }

  const candidateE1rm = recordE1rm(set);
  const bestE1rm = maxOf(pool, recordE1rm);
  if (candidateE1rm > 0 && bestE1rm > 0 && exceeds(candidateE1rm, bestE1rm)) {
    records.push({ kind: "e1rm", value: candidateE1rm, previous: bestE1rm });
  }

  // An empty rep pool means no prior set was ever this heavy, which makes "most
  // reps at this weight or above" a claim about nothing. It is also redundant:
  // that set is already winning the weight axis, and badging one lift as two
  // records is the noise this module exists to avoid.
  const repPool = atOrAboveWeight(pool, set.weight);
  if (repPool.length > 0) {
    const mostReps = maxOf(repPool, (entry) => entry.reps);
    const floor = maxOf(pool, effortScore) * WARMUP_EFFORT_FLOOR;
    const heavyEnough = effortScore(set) + PR_EPSILON >= floor;
    if (heavyEnough && exceeds(set.reps, mostReps)) {
      records.push({ kind: "reps", value: set.reps, previous: mostReps });
    }
  }

  return records.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
}

/**
 * The single record worth putting on screen when there is only room for one.
 * Sorts defensively rather than trusting the caller to have preserved order.
 */
export function headlineRecord(records: readonly PersonalRecord[]): PersonalRecord | undefined {
  if (!Array.isArray(records) || records.length === 0) return undefined;
  return records.reduce((best, current) =>
    kindRank(current.kind) < kindRank(best.kind) ? current : best,
  );
}

/** Chronological, falling back to the given order when a timestamp is unusable. */
function orderedByLog(sets: readonly WorkoutSet[]): WorkoutSet[] {
  return sets
    .map((set, index) => ({ set, index }))
    .sort((a, b) => {
      const left = a.set.loggedAt;
      const right = b.set.loggedAt;
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
      return a.index - b.index;
    })
    .map((entry) => entry.set);
}

/**
 * Marks the sets that a heavier set of the same exercise FOLLOWED in this
 * session. Those are warm-ups, or reps on the way up to a top set, and are not
 * things to celebrate.
 *
 * This is the exact version of the problem WARMUP_EFFORT_FLOOR can only guess
 * at, and it needs no threshold at all, because nobody warms up AFTER their top
 * set. It works only here, where the rest of the workout is visible; a live
 * per-set badge cannot know what the lifter is about to do next.
 *
 * Strictly heavier, so three straight sets at one weight never supersede each
 * other, and a back-off set stays eligible: 225x8 after a 315x3 top set is real
 * work, and often the most impressive thing in the session.
 *
 * Superseded sets are dropped as CANDIDATES only. They stay in the running
 * history, because they really happened, and an extra set in the comparison pool
 * can only ever make a later record harder to earn. That is the safe direction
 * to be wrong in.
 *
 * @param sets One exercise's sets from one session, in chronological order.
 */
function supersededInSession(sets: readonly WorkoutSet[]): boolean[] {
  const flags = new Array<boolean>(sets.length).fill(false);
  let heaviestAfter = 0;
  for (let i = sets.length - 1; i >= 0; i--) {
    flags[i] = exceeds(heaviestAfter, sets[i].weight);
    if (sets[i].weight > heaviestAfter) heaviestAfter = sets[i].weight;
  }
  return flags;
}

/** The pre-session best on one axis, or undefined when the baseline says nothing about it. */
function baselineBest(kind: PRKind, set: WorkoutSet, baseline: readonly WorkoutSet[]): number {
  if (kind === "weight") return maxOf(baseline, (entry) => entry.weight);
  if (kind === "e1rm") return maxOf(baseline, recordE1rm);
  return maxOf(atOrAboveWeight(baseline, set.weight), (entry) => entry.reps);
}

/**
 * Every personal record set across one whole session, for the post-workout
 * summary. One entry per exercise per axis, ordered by the exercise's first
 * appearance in the session and then by significance.
 *
 * `sets` may be the entire sets collection; only those belonging to `session`
 * are considered. `historyBefore` is everything logged prior, and any of this
 * session's own sets that appear in it are removed, so passing the same
 * unfiltered array to both arguments is safe.
 *
 * Four decisions shape the output:
 *
 * 0. A SET FOLLOWED BY A HEAVIER ONE IS A WARM-UP and is never a candidate.
 *    This is the one guard that needs the whole session to be visible, and it is
 *    why the end-of-workout summary is quieter and more trustworthy than a live
 *    per-set badge can be (see `supersededInSession`).
 *
 * 1. A SET CAN BEAT A RECORD SET EARLIER IN THE SAME SESSION, and it counts.
 *    Sets are walked in `loggedAt` order against a history that grows as it
 *    goes, exactly as the live per-set badge sees them. Refusing to count the
 *    second one would mean a lifter who works up 315x3, 315x4, 315x5 gets told
 *    about the 3 and never hears about the 5.
 * 2. ONLY THE BEST SURVIVES, per exercise per axis. That same session must not
 *    produce three rep-record entries; the summary reports 5 reps at 315. The
 *    earliest set to reach a value keeps the credit, since ties do not displace.
 * 3. `previous` IS MEASURED FROM BEFORE THE SESSION. Reporting "5 reps, up from
 *    4" when the 4 happened forty minutes ago is technically true and useless;
 *    the story is "up from 3, which is where you were last week". Where the
 *    pre-session history says nothing about that axis (a rep record at a weight
 *    never previously touched, reachable only because an earlier set today
 *    opened the weight band), it falls back to the value actually beaten.
 *
 * An exercise with no pre-session history contributes NOTHING, even if its third
 * set of the day beat its first. The first session of an exercise is the
 * baseline being established, not a run of records.
 */
export function sessionRecords(
  session: WorkoutSession | undefined,
  sets: readonly WorkoutSet[],
  historyBefore: readonly WorkoutSet[],
): SessionRecord[] {
  if (!isPlainObject(session)) return [];
  const sessionId = session.id;
  if (typeof sessionId !== "string" || sessionId.length === 0) return [];
  // Cardio sessions hold no sets and none of this applies to them. Compared
  // inline rather than through `isCardioSession` to keep store.ts a type-only
  // import; the default that `undefined` means strength is preserved either way.
  if (session.kind === "cardio") return [];
  if (!Array.isArray(sets) || !Array.isArray(historyBefore)) return [];

  const performed = orderedByLog(
    sets.filter((set): set is WorkoutSet => isComparableSet(set) && set.sessionId === sessionId),
  );
  if (performed.length === 0) return [];

  const priorSets = historyBefore.filter(
    (set): set is WorkoutSet => isComparableSet(set) && set.sessionId !== sessionId,
  );

  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of performed) {
    const existing = byExercise.get(set.exerciseId);
    if (existing) {
      existing.push(set);
    } else {
      byExercise.set(set.exerciseId, [set]);
    }
  }

  const results: SessionRecord[] = [];

  for (const [exerciseId, exerciseSets] of byExercise.entries()) {
    const baseline = priorSets.filter((set) => set.exerciseId === exerciseId);
    if (baseline.length === 0) continue;

    const winners = new Map<PRKind, { record: PersonalRecord; set: WorkoutSet }>();
    const running: WorkoutSet[] = [...baseline];
    const superseded = supersededInSession(exerciseSets);

    exerciseSets.forEach((set, index) => {
      if (!superseded[index]) {
        for (const record of personalRecordsFor(set, running)) {
          const held = winners.get(record.kind);
          if (!held || exceeds(record.value, held.record.value)) {
            winners.set(record.kind, { record, set });
          }
        }
      }
      running.push(set);
    });

    for (const kind of KIND_ORDER) {
      const winner = winners.get(kind);
      if (!winner) continue;
      const before = baselineBest(kind, winner.set, baseline);
      results.push({
        kind,
        value: winner.record.value,
        previous: before > 0 ? before : winner.record.previous,
        exerciseId,
        setId: winner.set.id,
      });
    }
  }

  return results;
}
